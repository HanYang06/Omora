/**
 * V1 tree runtime：公开状态机，把一份已 compose 的 dendro.tree/1 文档挂到宿主上。
 *
 * 输入是**已合法**的文档（组合在构建期完成，这一层不做 composer）；runtime 仍然自己
 * 再校验一次形状（`contract/tree.ts`）并查重复 id——坏文档不该把宿主带进半成品。
 *
 * 本模块只管公开 API 与状态（当前文档 / 已挂载根 / id 索引 / 诊断 / dispose）；建树、
 * 清退旧子树、放进宿主、卸载与回滚这些挂载事务在 `runtime_apply.ts`。
 *
 * 挂载语义：
 * - mount：校验 → 事务挂载；建树任何一步失败整棵回滚，runtime 保持未挂载。
 * - replace：校验 → 按稳定 id 复用同 kind、同父的渲染器（update），新节点 mount，
 *   新树里没有的旧子树后序卸载；全部成功后才换文档。校验失败旧树保持不动；渲染 /
 *   宿主失败整棵回滚到未挂载（fail closed，不留半成品）。
 * - unmount：后序卸载全部渲染器，再从根宿主摘下根；runtime 可再次 mount。
 * - dispose：unmount 后收口；此后 mount / replace 一律 E-TREE-DISPOSED，unmount 空操作。
 *
 * 生命周期顺序：挂载父先子后；卸载子先父后。renderer.unmount 只清自己，子节点由
 * runtime 卸；同一渲染器实例的 child host 在实例存活期间必须稳定。
 *
 * 失败隔离：单个 renderer.unmount / host.unmount 抛错记 E-TREE-RENDER 后继续撤其余
 * 节点；成功替换但清退旧节点失败时结果仍 ok，诊断留在 `diagnostics` 里。
 */

import type { Document as TreeDocument } from "../../contract/tree_generated";
import { applyBatch } from "./apply";
import { parseOps } from "./ops";
import type { RendererRegistry, TreeHost, TreeRuntimeDiagnostic } from "./types";
import {
  applyDocument,
  buildDetachedSubtree,
  detachMountedSubtree,
  placeDetachedSubtree,
  unmountTree,
  type DetachedSubtree,
  type MountedNode,
  type TreeApplyContext,
} from "./runtime_apply";
import { validateDocument } from "./validate";

/** 挂载配置：根宿主与 kind 注册表都由调用方注入。 */
export interface TreeRuntimeOptions {
  /** 根节点的挂载宿主；runtime 只调 mount / update / unmount。 */
  host: TreeHost;
  /** kind → renderer 工厂。 */
  renderers: RendererRegistry;
}

/** 挂载失败：诊断非空，宿主与 runtime 都回到调用前的干净状态。 */
export interface TreeMountFailure {
  ok: false;
  diagnostics: TreeRuntimeDiagnostic[];
}

/** mount / replace 的结果；成功时诊断通过 `diagnostics` getter 读。 */
export type TreeMountResult = { ok: true } | TreeMountFailure;

/** applyOps 的结果：成功给被触碰的子树根 id。 */
export type TreeUpdateResult = { ok: true; changed: string[] } | TreeMountFailure;

export class TreeRuntime {
  private readonly host: TreeHost;
  private readonly renderers: RendererRegistry;
  private root: MountedNode | null = null;
  private current: TreeDocument | null = null;
  private byId = new Map<string, MountedNode>();
  private lastDiagnostics: TreeRuntimeDiagnostic[] = [];
  private isDisposed = false;

  constructor(options: TreeRuntimeOptions) {
    this.host = options.host;
    this.renderers = options.renderers;
  }

  get mounted(): boolean {
    return this.root !== null;
  }

  /** 当前挂载的文档（原样引用，runtime 不改写它）；未挂载时 null。 */
  get document(): TreeDocument | null {
    return this.current;
  }

  /** 最近一次 mount / replace / unmount 之后的诊断；成功后一般清空。 */
  get diagnostics(): readonly TreeRuntimeDiagnostic[] {
    return this.lastDiagnostics;
  }

  get disposed(): boolean {
    return this.isDisposed;
  }

  /** 首次挂载：坏文档 / 未知 kind / 渲染失败都不产生半个宿主状态。 */
  mount(value: unknown): TreeMountResult {
    const closed = this.rejectWhenDisposed();
    if (closed !== null) {
      return closed;
    }
    if (this.root !== null) {
      return this.fail([
        { code: "E-TREE-STATE", path: "", message: "已经挂载；先 unmount 或 replace" },
      ]);
    }
    const checked = validateDocument(value);
    if (!checked.ok) {
      return this.fail(checked.diagnostics);
    }
    return this.attachDocument(checked.document, null, undefined);
  }

  /** 用新文档替换当前文档：按 id 复用渲染器，失败时旧树不动（渲染失败则收口到未挂载）。 */
  replace(value: unknown): TreeMountResult {
    const closed = this.rejectWhenDisposed();
    if (closed !== null) {
      return closed;
    }
    if (this.root === null) {
      return this.mount(value);
    }
    const checked = validateDocument(value);
    if (!checked.ok) {
      return this.fail(checked.diagnostics);
    }
    return this.attachDocument(checked.document, this.root, this.byId);
  }

  /**
   * 应用一批 ops：文档层先算新文档（版本 / 原子 / 路径复制），成功后按最终状态只改
   * 被触碰的已挂载子树。支持 setProps / mount / unmount；replace 与 data 下一步接。
   *
   * 结构操作按“子树”处理：mount 建一棵新子树挂到父节点；unmount 摘一棵；不重建整棵树。
   * 一次批量里不允许嵌套 mount（新子树应自带子节点）；所有新子树先建好再改 DOM。
   * 构建失败回滚已建的子树；宿主阶段的失败是 best effort（结构变更无法完整回滚）。
   */
  applyOps(value: unknown): TreeUpdateResult {
    const closed = this.rejectWhenDisposed();
    if (closed !== null) {
      return closed;
    }
    if (this.root === null || this.current === null) {
      return this.fail([{ code: "E-TREE-STATE", path: "", message: "还没挂载；先 mount" }]);
    }
    const parsed = parseOps(value);
    if (!parsed.ok) {
      return this.fail(
        parsed.diagnostics.map((diagnostic) => ({
          code: diagnostic.code,
          path: diagnostic.path,
          message: diagnostic.message,
        })),
      );
    }
    if (parsed.batch.ops.some((op) => op.op === "data")) {
      return this.fail([
        { code: "E-PAYLOAD", path: "/ops", message: "data op 还没接（下一步：collection / 绑定）" },
      ]);
    }
    if (parsed.batch.ops.some((op) => op.op === "replace")) {
      return this.fail([
        { code: "E-PAYLOAD", path: "/ops", message: "运行时 replace 还没接；下一步" },
      ]);
    }
    const mountedThisBatch = new Set<string>();
    const unmountedThisBatch = new Set<string>();
    for (const op of parsed.batch.ops) {
      if (op.op === "mount") {
        mountedThisBatch.add(op.node.id);
      } else if (op.op === "unmount") {
        unmountedThisBatch.add(op.id);
      }
    }
    if ([...mountedThisBatch].some((id) => unmountedThisBatch.has(id))) {
      return this.fail([
        {
          code: "E-PAYLOAD",
          path: "/ops",
          message: "同一批里不要摘了又挂同一个 id；分成两批",
        },
      ]);
    }
    const applied = applyBatch(this.current, parsed.batch);
    if (!applied.ok) {
      return this.fail(
        applied.diagnostics.map((diagnostic) => ({
          code: diagnostic.code,
          path: diagnostic.path,
          message: diagnostic.message,
        })),
      );
    }
    const context = this.newContext();
    const removed: MountedNode[] = [];
    const added: string[] = [];
    const updated: string[] = [];
    for (const id of applied.changed) {
      const old = this.byId.get(id);
      const next = applied.byId.get(id);
      if (old !== undefined && next === undefined) {
        removed.push(old);
      } else if (old === undefined && next !== undefined) {
        added.push(id);
      } else if (old !== undefined && next !== undefined) {
        updated.push(id);
      }
    }
    // 只处理被摘子树的最高根；后代跟着整棵走。
    const removedIds = new Set(removed.map((node) => node.node.id));
    const removedRoots = removed.filter((node) => {
      let parent = node.parent;
      while (parent !== null) {
        if (removedIds.has(parent.node.id)) {
          return false;
        }
        parent = parent.parent;
      }
      return true;
    });
    // 新子树先全部建好（此时不碰 DOM）；父必须已经挂载，且不能是本批新挂的节点。
    const built: Array<{
      subtree: DetachedSubtree;
      parent: MountedNode;
      host: TreeHost;
      index: number;
    }> = [];
    const addedIds = new Set<string>();
    const byDepth = (left: string, right: string): number =>
      depthOf(applied.byId.get(left)?.chain ?? "") - depthOf(applied.byId.get(right)?.chain ?? "");
    for (const id of [...added].sort(byDepth)) {
      const next = applied.byId.get(id);
      if (next === undefined) {
        continue;
      }
      const parentId = parentIdOf(next.chain);
      if (parentId === null || added.includes(parentId)) {
        return this.fail([
          {
            code: "E-PAYLOAD",
            path: "/ops",
            message: "一次批量里不要嵌套 mount；把子节点放进同一棵子树",
          },
        ]);
      }
      const parent = this.byId.get(parentId);
      if (parent === undefined) {
        return this.fail([
          { code: "E-TARGET-MISSING", path: "/ops", message: "父节点没有挂载: " + parentId },
        ]);
      }
      const host = parent.childHost;
      if (host === null) {
        return this.fail([
          { code: "E-TREE-HOST", path: "/ops", message: "父节点不接受子节点: " + parentId },
        ]);
      }
      const index = insertionIndex(parent, next.order);
      if (index < 0) {
        return this.fail([
          { code: "E-TREE-ORDER", path: "/ops", message: "同级 order 冲突: " + String(next.order) },
        ]);
      }
      try {
        built.push({
          subtree: buildDetachedSubtree(context, next, parent, "/ops"),
          parent,
          host,
          index,
        });
      } catch (error) {
        for (const entry of built) {
          detachMountedSubtree(context, entry.subtree.root, entry.host);
        }
        return this.fail([...diagnosticsOfError(error), ...context.cleanup]);
      }
      addedIds.add(id);
    }
    const appliedUpdates: Array<{
      mounted: MountedNode;
      previous: MountedNode["node"];
      next: MountedNode["node"];
    }> = [];
    try {
      for (const node of removedRoots) {
        const parent = node.parent;
        if (parent === null) {
          return this.fail([{ code: "E-PAYLOAD", path: "/ops", message: "根不能卸载" }]);
        }
        const host = parent.childHost;
        if (host === null) {
          return this.fail([
            { code: "E-TREE-HOST", path: "/ops", message: "父节点不接受子节点: " + parent.node.id },
          ]);
        }
        const at = parent.children.indexOf(node);
        if (at >= 0) {
          parent.children.splice(at, 1);
        }
        detachMountedSubtree(context, node, host);
        for (const id of mountedIds(node)) {
          this.byId.delete(id);
        }
        reindex(parent, host);
      }
      for (const entry of built) {
        placeDetachedSubtree(context, entry.subtree, entry.host, entry.index);
        entry.parent.children.splice(entry.index, 0, entry.subtree.root);
        for (const [id, mounted] of entry.subtree.byId) {
          this.byId.set(id, mounted);
          addedIds.add(id);
        }
        reindex(entry.parent, entry.host);
      }
      for (const id of updated) {
        if (addedIds.has(id)) {
          continue;
        }
        const mounted = this.byId.get(id);
        const next = applied.byId.get(id);
        if (mounted === undefined || next === undefined) {
          continue;
        }
        appliedUpdates.push({ mounted, previous: mounted.node, next });
      }
      for (const update of appliedUpdates) {
        this.setNode(update.mounted, update.next);
        update.mounted.renderer.update(update.next, update.mounted.output);
      }
    } catch (error) {
      for (const update of [...appliedUpdates].reverse()) {
        this.setNode(update.mounted, update.previous);
        try {
          update.mounted.renderer.update(update.previous, update.mounted.output);
        } catch {
          // 回滚也是 best effort；诊断里已经报了首次失败。
        }
      }
      return this.fail([...diagnosticsOfError(error), ...context.cleanup]);
    }
    // 只更新被触碰的目标节点；未触碰祖先的 MountedNode.node 仍是旧对象。
    // 语义以 this.current（新文档）为准；祖先的 kind / chain 不变，不影响复用判断。
    this.current = applied.document;
    this.lastDiagnostics = context.cleanup;
    return { ok: true, changed: applied.changed };
  }
  /** 换挂载节点持有的文档对象与 handle；元素 / 渲染器不动。 */
  private setNode(mounted: MountedNode, node: MountedNode["node"]): void {
    mounted.node = node;
    mounted.handle = { node, output: mounted.output };
  }

  /** 卸掉整棵树（后序渲染器），runtime 保持可用。未挂载 / 已 dispose 时是空操作。 */
  unmount(): void {
    if (this.isDisposed || this.root === null) {
      return;
    }
    const context = this.newContext();
    unmountTree(context, this.root);
    const diagnostics = context.cleanup;
    this.clearState();
    this.lastDiagnostics = diagnostics;
  }

  /** 卸载并收口；幂等，之后不再接受 mount / replace。 */
  dispose(): void {
    if (this.isDisposed) {
      return;
    }
    this.unmount();
    this.isDisposed = true;
  }

  /** 跑一次挂载事务，成功才换 runtime 状态；失败清空状态并暴露事务诊断。 */
  private attachDocument(
    document: TreeDocument,
    oldRoot: MountedNode | null,
    oldById: Map<string, MountedNode> | undefined,
  ): TreeMountResult {
    const context = this.newContext();
    const applied = applyDocument(context, document, oldRoot, oldById);
    if (!applied.ok) {
      this.clearState();
      return this.fail(applied.diagnostics);
    }
    this.current = document;
    this.root = applied.root;
    this.byId = applied.byId;
    this.lastDiagnostics = context.cleanup;
    return { ok: true };
  }

  private newContext(): TreeApplyContext {
    return { host: this.host, renderers: this.renderers, cleanup: [] };
  }

  private clearState(): void {
    this.root = null;
    this.current = null;
    this.byId = new Map();
  }

  private rejectWhenDisposed(): TreeMountFailure | null {
    if (!this.isDisposed) {
      return null;
    }
    return this.fail([
      {
        code: "E-TREE-DISPOSED",
        path: "",
        message: "runtime 已 dispose，不再接受 mount / replace",
      },
    ]);
  }

  private fail(diagnostics: TreeRuntimeDiagnostic[]): TreeMountFailure {
    this.lastDiagnostics = diagnostics;
    return { ok: false, diagnostics };
  }
}

function depthOf(chain: string): number {
  return chain === "" ? 0 : chain.split(".").length;
}

function parentIdOf(chain: string): string | null {
  const segments = chain.split(".");
  return segments.length < 2 ? null : (segments[segments.length - 2] ?? null);
}

/** 同级按 order 升序：第一个更大的子节点之前就是插入点；order 撞了返回 -1。 */
function insertionIndex(parent: MountedNode, order: number): number {
  for (let index = 0; index < parent.children.length; index += 1) {
    const child = parent.children[index];
    if (child === undefined) {
      continue;
    }
    if (child.node.order === order) {
      return -1;
    }
    if (child.node.order > order) {
      return index;
    }
  }
  return parent.children.length;
}

function reindex(parent: MountedNode, host: TreeHost): void {
  parent.children.forEach((child, index) => {
    host.update(child.handle, index);
  });
}

function mountedIds(node: MountedNode): string[] {
  const ids = [node.node.id];
  for (const child of node.children) {
    ids.push(...mountedIds(child));
  }
  return ids;
}

function diagnosticsOfError(error: unknown): TreeRuntimeDiagnostic[] {
  return [
    {
      code: "E-TREE-RENDER",
      path: "",
      message: "运行时结构更新失败: " + (error instanceof Error ? error.message : String(error)),
    },
  ];
}

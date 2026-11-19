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
import { applyBatch, type ApplyDiagnostic } from "./apply";
import { parseOps, type OpsDiagnostic } from "./ops";
import type { RendererRegistry, TreeHost, TreeRuntimeDiagnostic } from "./types";
import {
  applyDocument,
  unmountTree,
  type MountedNode,
  type TreeApplyContext,
} from "./runtime_apply";
import { mergeCollectionInstances, reorderCollections } from "./runtime_collections";
import { applyMountedUpdate } from "./runtime_update";

const DEFAULT_LOCALE = "zh-CN";
import { validateDocument } from "./validate";

function toRuntimeDiagnostic(diagnostic: ApplyDiagnostic | OpsDiagnostic): TreeRuntimeDiagnostic {
  return { code: diagnostic.code, path: diagnostic.path, message: diagnostic.message };
}

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
   * 应用一批 ops：文档层算新文档（版本 / 原子 / 路径复制 / data），运行时只改被触碰的
   * 子树。支持 setProps / mount / unmount / replace；data 只写文档数据、不进 changed，
   * 运行时 patch 阶段没有要改的节点。
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
      return this.fail(parsed.diagnostics.map(toRuntimeDiagnostic));
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
    const replaceIds = parsed.batch.ops.filter((op) => op.op === "replace").map((op) => op.id);
    if (replaceIds.some((id) => mountedThisBatch.has(id))) {
      return this.fail([
        {
          code: "E-PAYLOAD",
          path: "/ops",
          message: "同一批里不要 mount 后再 replace；分成两批",
        },
      ]);
    }
    const applied = applyBatch(this.current, parsed.batch);
    if (!applied.ok) {
      return this.fail(applied.diagnostics.map(toRuntimeDiagnostic));
    }
    const dataSources = new Set<string>();
    for (const op of parsed.batch.ops) {
      if (op.op === "data") {
        dataSources.add(op.source);
      }
    }
    const reconciled =
      dataSources.size === 0
        ? null
        : mergeCollectionInstances(this.byId, applied, dataSources);
    const context = this.newContext(
      applied.document.data,
      applied.document.messages ?? {},
      applied.document.locale ?? DEFAULT_LOCALE,
    );
    const updated = applyMountedUpdate(
      { byId: this.byId, context },
      reconciled?.applied ?? applied,
      parsed.batch,
    );
    if (!updated.ok) {
      return this.fail([...updated.diagnostics, ...context.cleanup]);
    }
    const reorderDiagnostics =
      reconciled === null ? [] : reorderCollections(reconciled.collections);
    // 只更新被触碰的目标节点；未触碰祖先的 MountedNode.node 仍是旧对象。
    // 语义以 this.current（新文档）为准；祖先的 kind / chain 不变，不影响复用判断。
    this.current = applied.document;
    this.lastDiagnostics = [
      ...applied.diagnostics,
      ...(reconciled?.diagnostics ?? []),
      ...reorderDiagnostics,
      ...context.cleanup,
    ];
    // data 只改数据：实例 id 不对外暴露，公开 changed 仍只含结构节点。
    const structural = new Set(applied.changed);
    return { ok: true, changed: updated.changed.filter((id) => structural.has(id)) };
  }

  /** 卸掉整棵树（后序渲染器），runtime 保持可用。未挂载 / 已 dispose 时是空操作。 */
  unmount(): void {
    if (this.isDisposed || this.root === null) {
      return;
    }
    const context = this.newContext(
      this.current?.data ?? {},
      this.current?.messages ?? {},
      this.current?.locale ?? DEFAULT_LOCALE,
    );
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
    const context = this.newContext(
      document.data,
      document.messages ?? {},
      document.locale ?? DEFAULT_LOCALE,
    );
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

  private newContext(
    data: Record<string, unknown> = {},
    messages: Record<string, string> = {},
    locale: string = DEFAULT_LOCALE,
  ): TreeApplyContext {
    return { host: this.host, renderers: this.renderers, data, messages, locale, cleanup: [] };
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

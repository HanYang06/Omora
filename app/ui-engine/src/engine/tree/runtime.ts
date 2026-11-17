/**
 * V1 tree runtime：把一份已 compose 的 dendro.tree/1 文档挂到宿主上。
 *
 * 输入是**已合法**的文档（组合在构建期完成，这一层不做 composer）；runtime 仍然自己
 * 再校验一次形状（`contract/tree.ts`）并查重复 id——坏文档不该把宿主带进半成品。
 *
 * 挂载语义：
 * - mount：校验 → 自顶向下建渲染器（父先子后）→ 把整棵新树放进宿主（根先，子按
 *   layout 顺序）。建树任何一步失败（未知 kind、渲染器抛错、不接受子节点）整棵回滚，
 *   根宿主不被触碰，runtime 保持未挂载。
 * - replace：校验 → 按稳定 id 复用同 kind、同父的渲染器（调 update），新节点建渲染器
 *   （mount），新树里没有的旧子树后序卸载；全部成功后才换文档。校验失败旧树保持不动；
 *   渲染 / 宿主失败整棵回滚到未挂载（fail closed，不留半成品）。
 * - unmount：后序卸载全部渲染器，再从根宿主摘下根；runtime 可再次 mount。
 * - dispose：unmount 后收口；此后 mount / replace 一律 E-TREE-DISPOSED，unmount 空操作。
 *
 * 生命周期顺序：挂载父先子后；卸载子先父后。renderer.unmount 只清自己，子节点由
 * runtime 卸；同一渲染器实例的 child host 在实例存活期间必须稳定。
 *
 * 失败隔离：单个 renderer.unmount / host.unmount 抛错记 E-TREE-RENDER 后继续撤其余
 * 节点；成功替换但清退旧节点失败时结果仍 ok，诊断留在 `diagnostics` 里。
 */

import type { Document as TreeDocument, Node as TreeNode } from "../../contract/tree_generated";
import type {
  NodeRenderer,
  RendererRegistry,
  TreeChildHandle,
  TreeHost,
  TreeOutput,
  TreeRuntimeDiagnostic,
} from "./types";
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

/** runtime 内部的已挂载节点：渲染器实例 + 输出 + 子挂载点都是挂载期确定的。 */
interface MountedNode {
  readonly node: TreeNode;
  readonly renderer: NodeRenderer;
  readonly output: TreeOutput;
  readonly childHost: TreeHost | null;
  readonly parent: MountedNode | null;
  /** replace 时被复用的旧节点；mount / 新节点为 undefined。 */
  readonly reusedFrom: MountedNode | undefined;
  readonly path: string;
  readonly handle: TreeChildHandle;
  children: MountedNode[];
  /** 卸载只跑一次（失败回滚与正常清退可能都走到同一节点）。 */
  released: boolean;
}

/** 挂载中止：携带诊断，只在 runtime 内部抛，公开方法 catch 后转成 TreeMountFailure。 */
class TreeAbort extends Error {
  readonly diagnostics: TreeRuntimeDiagnostic[];

  constructor(diagnostics: TreeRuntimeDiagnostic[]) {
    super(diagnostics[0]?.message ?? "树挂载失败");
    this.name = "TreeAbort";
    this.diagnostics = diagnostics;
  }
}

export class TreeRuntime {
  private readonly host: TreeHost;
  private readonly renderers: RendererRegistry;
  private root: MountedNode | null = null;
  private current: TreeDocument | null = null;
  private byId = new Map<string, MountedNode>();
  private lastDiagnostics: TreeRuntimeDiagnostic[] = [];
  /** 当前这次挂载 / 卸载里被隔离掉的清理失败。 */
  private cleanupDiagnostics: TreeRuntimeDiagnostic[] = [];
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
    return this.applyDocument(checked.document, null, undefined);
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
    return this.applyDocument(checked.document, this.root, this.byId);
  }

  /** 卸掉整棵树（后序渲染器），runtime 保持可用。未挂载 / 已 dispose 时是空操作。 */
  unmount(): void {
    if (this.isDisposed || this.root === null) {
      return;
    }
    this.cleanupDiagnostics = [];
    const root = this.root;
    this.releaseSubtree(root);
    this.detachRoot(root);
    const diagnostics = this.cleanupDiagnostics;
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

  /**
   * 把文档挂上去：先建完整棵新树（渲染器 mount / update），再清退旧节点，最后放进宿主。
   * 任何一步失败都回滚：旧树全部卸载、新节点全部卸载、根宿主摘掉，runtime 回到未挂载。
   */
  private applyDocument(
    document: TreeDocument,
    oldRoot: MountedNode | null,
    oldById: Map<string, MountedNode> | undefined,
  ): TreeMountResult {
    const nextById = new Map<string, MountedNode>();
    const fresh: MountedNode[] = [];
    // 根宿主当前挂着谁：mount 时是 null；replace 时先指向旧根，放置后换新根。
    const attached: { node: MountedNode | null } = { node: oldRoot };
    this.cleanupDiagnostics = [];
    try {
      const root = this.buildNode(document.root, "/root", null, oldById, nextById, fresh);
      if (oldRoot !== null) {
        this.retireStale(oldRoot, nextById, attached);
      }
      this.placeSubtree(root, this.host, 0, attached);
      this.current = document;
      this.root = root;
      this.byId = nextById;
      this.lastDiagnostics = this.cleanupDiagnostics;
      return { ok: true };
    } catch (error) {
      if (oldRoot !== null) {
        this.releaseSubtree(oldRoot);
      }
      this.releaseFresh(fresh);
      if (attached.node !== null) {
        this.detachRoot(attached.node);
      }
      this.clearState();
      return this.fail([...diagnosticsOf(error), ...this.cleanupDiagnostics]);
    }
  }

  /** 建一个节点及其子树：复用的旧实例只 update，新节点走工厂 + mount；父先子后。 */
  private buildNode(
    node: TreeNode,
    path: string,
    parent: MountedNode | null,
    oldById: Map<string, MountedNode> | undefined,
    nextById: Map<string, MountedNode>,
    fresh: MountedNode[],
  ): MountedNode {
    const old = oldById?.get(node.id);
    const reusable =
      old !== undefined && old.node.kind === node.kind && parentRetained(old, parent);
    let renderer: NodeRenderer;
    let output: TreeOutput;
    let childHost: TreeHost | null;
    let reusedFrom: MountedNode | undefined;
    if (reusable && old !== undefined) {
      renderer = old.renderer;
      output = old.output;
      childHost = old.childHost;
      reusedFrom = old;
      this.invoke(path, () => {
        renderer.update(node, output);
      });
    } else {
      const factory = this.renderers.get(node.kind);
      if (factory === undefined) {
        throw new TreeAbort([
          { code: "E-TREE-KIND", path: path + "/kind", message: "没有注册的 kind: " + node.kind },
        ]);
      }
      renderer = this.invoke(path, () => factory(node));
      const created = this.invoke(path, () => renderer.mount(node));
      output = created.output;
      childHost = created.host;
    }
    const mounted: MountedNode = {
      node,
      renderer,
      output,
      childHost,
      parent,
      reusedFrom,
      path,
      handle: { node, output },
      children: [],
      released: false,
    };
    if (!reusable) {
      fresh.push(mounted);
    }
    if (childHost === null && node.layout.length > 0) {
      // 已经 mount 出输出：先登记进 fresh，回滚时才卸得掉，不留半个渲染器。
      throw new TreeAbort([
        {
          code: "E-TREE-HOST",
          path: path + "/layout",
          message: "kind " + node.kind + " 不接受子节点，但节点有 layout",
        },
      ]);
    }
    nextById.set(node.id, mounted);
    mounted.children = node.layout.map((child, index) => {
      return this.buildNode(child, path + "/layout/" + index, mounted, oldById, nextById, fresh);
    });
    return mounted;
  }

  /**
   * 清退新树里不存在的旧子树：先后序卸渲染器，再把顶层节点从旧父宿主 / 根宿主摘下。
   * 只在整棵新树建好之后才跑，失败可以被 applyDocument 回滚。
   */
  private retireStale(
    oldRoot: MountedNode,
    nextById: Map<string, MountedNode>,
    attached: { node: MountedNode | null },
  ): void {
    for (const stale of staleTops(oldRoot, nextById)) {
      this.releaseSubtree(stale);
      const host = stale.parent === null ? this.host : stale.parent.childHost;
      if (host === null) {
        throw new TreeAbort([
          { code: "E-TREE-HOST", path: stale.path, message: "旧父节点没有子宿主" },
        ]);
      }
      this.invoke(stale.path, () => {
        host.unmount(stale.handle);
      });
      if (stale.parent === null) {
        attached.node = null;
      }
    }
  }

  /** 把新树放进宿主：复用的节点 update（同宿主），新节点 mount；父先子后。 */
  private placeSubtree(
    node: MountedNode,
    host: TreeHost,
    index: number,
    attached?: { node: MountedNode | null },
  ): void {
    if (node.reusedFrom !== undefined) {
      this.invoke(node.path, () => {
        host.update(node.handle, index);
      });
    } else {
      this.invoke(node.path, () => {
        host.mount(node.handle, index);
      });
    }
    if (attached !== undefined) {
      attached.node = node;
    }
    const childHost = node.childHost;
    if (node.children.length === 0) {
      return;
    }
    if (childHost === null) {
      throw new TreeAbort([
        { code: "E-TREE-HOST", path: node.path, message: "渲染器不接受子节点，但节点有 children" },
      ]);
    }
    node.children.forEach((child, childIndex) => {
      this.placeSubtree(child, childHost, childIndex);
    });
  }

  /** 后序卸载整棵子树（子先父后）；已卸过的节点跳过。 */
  private releaseSubtree(node: MountedNode): void {
    for (const child of node.children) {
      this.releaseSubtree(child);
    }
    this.releaseNode(node);
  }

  /** 回滚新建节点：按建树顺序逆序，保证子先父后。 */
  private releaseFresh(fresh: MountedNode[]): void {
    for (let index = fresh.length - 1; index >= 0; index -= 1) {
      const node = fresh[index];
      if (node !== undefined) {
        this.releaseNode(node);
      }
    }
  }

  private releaseNode(node: MountedNode): void {
    if (node.released) {
      return;
    }
    node.released = true;
    try {
      node.renderer.unmount(node.node, node.output);
    } catch (error) {
      this.cleanupDiagnostics.push({
        code: "E-TREE-RENDER",
        path: node.path,
        message: "卸载渲染器失败: " + messageOf(error),
      });
    }
  }

  /** 从根宿主摘下整棵树；失败记诊断，不抛。 */
  private detachRoot(node: MountedNode): void {
    try {
      this.host.unmount(node.handle);
    } catch (error) {
      this.cleanupDiagnostics.push({
        code: "E-TREE-RENDER",
        path: node.path,
        message: "从根宿主摘下失败: " + messageOf(error),
      });
    }
  }

  /** 调外部实现（渲染器 / 宿主）；异常统一折成 E-TREE-RENDER 挂载中止。 */
  private invoke<T>(path: string, operation: () => T): T {
    try {
      return operation();
    } catch (error) {
      throw new TreeAbort([
        { code: "E-TREE-RENDER", path, message: "渲染 / 宿主调用失败: " + messageOf(error) },
      ]);
    }
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

/** 旧节点能被复用，前提是它在新树里的父节点也是同一个旧节点（父先被复用）。 */
function parentRetained(old: MountedNode, parent: MountedNode | null): boolean {
  if (parent === null) {
    return old.parent === null;
  }
  return old.parent !== null && old.parent === parent.reusedFrom;
}

/**
 * 找旧树里的“顶层被撤节点”：自己没被新树复用、父节点被复用（或自己是旧根）。
 * 一棵没被复用的节点，它的后代也不可能被复用（复用要求父先复用），所以不用下探。
 */
function staleTops(oldRoot: MountedNode, nextById: Map<string, MountedNode>): MountedNode[] {
  const retained = new Set<MountedNode>();
  for (const mounted of nextById.values()) {
    if (mounted.reusedFrom !== undefined) {
      retained.add(mounted.reusedFrom);
    }
  }
  const stale: MountedNode[] = [];
  const visit = (node: MountedNode): void => {
    if (!retained.has(node)) {
      if (node.parent === null || retained.has(node.parent)) {
        stale.push(node);
      }
      return;
    }
    for (const child of node.children) {
      visit(child);
    }
  };
  visit(oldRoot);
  return stale;
}

function diagnosticsOf(error: unknown): TreeRuntimeDiagnostic[] {
  if (error instanceof TreeAbort) {
    return error.diagnostics;
  }
  return [{ code: "E-TREE-RENDER", path: "", message: "挂载失败: " + messageOf(error) }];
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "非 Error 异常";
}

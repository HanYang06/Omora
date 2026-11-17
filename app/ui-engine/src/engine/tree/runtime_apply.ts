/**
 * V1 tree runtime 的挂载事务：把一份已校验的文档「建树 → 清退旧子树 → 放进宿主」，
 * 以及卸载 / 回滚。TreeRuntime 只负责公开状态机与校验；这里不碰文档形状，也不持有
 * runtime 状态——根宿主、kind 注册表、本次操作的诊断缓冲都由调用方注入。
 *
 * 事务语义：
 * - applyDocument：先建完整棵新树（渲染器 mount / update），再清退旧节点，最后放进
 *   宿主。任何一步失败都回滚：旧树全部卸载、新节点全部卸载、根宿主摘掉。
 * - unmountTree：后序卸载全部渲染器，再从根宿主摘下根。
 * - 生命周期顺序：建树父先子后；卸载子先父后；renderer.unmount 只清自己。
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

/** 事务需要的 runtime 能力：根宿主、kind 注册表、本次操作的清理诊断缓冲。 */
export interface TreeApplyContext {
  readonly host: TreeHost;
  readonly renderers: RendererRegistry;
  /** 被隔离掉的清理失败（renderer.unmount / host.unmount 抛错）写进这里。 */
  readonly cleanup: TreeRuntimeDiagnostic[];
}

/** runtime 内部的已挂载节点：渲染器实例 + 输出 + 子挂载点都是挂载期确定的。 */
export interface MountedNode {
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

/** applyDocument 的结果：成功给新根与 id 索引；失败只给诊断，调用方负责清状态。 */
export type TreeApplyResult =
  | { ok: true; root: MountedNode; byId: Map<string, MountedNode> }
  | { ok: false; diagnostics: TreeRuntimeDiagnostic[] };

/** 挂载中止：携带诊断，只在事务内部抛，applyDocument catch 后转成 TreeApplyResult。 */
class TreeAbort extends Error {
  readonly diagnostics: TreeRuntimeDiagnostic[];

  constructor(diagnostics: TreeRuntimeDiagnostic[]) {
    super(diagnostics[0]?.message ?? "树挂载失败");
    this.name = "TreeAbort";
    this.diagnostics = diagnostics;
  }
}

/**
 * 把文档挂上去：建新树 →（replace 时）清退旧子树 → 放进宿主。
 * 失败时回滚到“什么都没挂”的干净状态，由 runtime 决定之后暴露什么诊断。
 */
export function applyDocument(
  context: TreeApplyContext,
  document: TreeDocument,
  oldRoot: MountedNode | null,
  oldById: Map<string, MountedNode> | undefined,
): TreeApplyResult {
  const nextById = new Map<string, MountedNode>();
  const fresh: MountedNode[] = [];
  // 根宿主当前挂着谁：mount 时是 null；replace 时先指向旧根，放置后换新根。
  const attached: { node: MountedNode | null } = { node: oldRoot };
  try {
    const root = buildNode(context, document.root, "/root", null, oldById, nextById, fresh);
    if (oldRoot !== null) {
      retireStale(context, oldRoot, nextById, attached);
    }
    placeSubtree(context, root, context.host, 0, attached);
    return { ok: true, root, byId: nextById };
  } catch (error) {
    if (oldRoot !== null) {
      releaseSubtree(context, oldRoot);
    }
    releaseFresh(context, fresh);
    if (attached.node !== null) {
      detachRoot(context, attached.node);
    }
    return { ok: false, diagnostics: [...diagnosticsOf(error), ...context.cleanup] };
  }
}

/** 后序卸载整棵树，再从根宿主摘下根；清理失败只记诊断，不抛。 */
export function unmountTree(context: TreeApplyContext, root: MountedNode): void {
  releaseSubtree(context, root);
  detachRoot(context, root);
}

/** 建一个节点及其子树：复用的旧实例只 update，新节点走工厂 + mount；父先子后。 */
function buildNode(
  context: TreeApplyContext,
  node: TreeNode,
  path: string,
  parent: MountedNode | null,
  oldById: Map<string, MountedNode> | undefined,
  nextById: Map<string, MountedNode>,
  fresh: MountedNode[],
): MountedNode {
  const old = oldById?.get(node.id);
  const reusable = old !== undefined && old.node.kind === node.kind && parentRetained(old, parent);
  let renderer: NodeRenderer;
  let output: TreeOutput;
  let childHost: TreeHost | null;
  let reusedFrom: MountedNode | undefined;
  if (reusable && old !== undefined) {
    renderer = old.renderer;
    output = old.output;
    childHost = old.childHost;
    reusedFrom = old;
    invoke(path, () => {
      renderer.update(node, output);
    });
  } else {
    const factory = context.renderers.get(node.kind);
    if (factory === undefined) {
      throw new TreeAbort([
        { code: "E-TREE-KIND", path: path + "/kind", message: "没有注册的 kind: " + node.kind },
      ]);
    }
    renderer = invoke(path, () => factory(node));
    const created = invoke(path, () => renderer.mount(node));
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
    return buildNode(context, child, path + "/layout/" + index, mounted, oldById, nextById, fresh);
  });
  return mounted;
}

/**
 * 清退新树里不存在的旧子树：先后序卸渲染器，再把顶层节点从旧父宿主 / 根宿主摘下。
 * 只在整棵新树建好之后才跑，失败可以被 applyDocument 回滚。
 */
function retireStale(
  context: TreeApplyContext,
  oldRoot: MountedNode,
  nextById: Map<string, MountedNode>,
  attached: { node: MountedNode | null },
): void {
  for (const stale of staleTops(oldRoot, nextById)) {
    releaseSubtree(context, stale);
    const host = stale.parent === null ? context.host : stale.parent.childHost;
    if (host === null) {
      throw new TreeAbort([
        { code: "E-TREE-HOST", path: stale.path, message: "旧父节点没有子宿主" },
      ]);
    }
    invoke(stale.path, () => {
      host.unmount(stale.handle);
    });
    if (stale.parent === null) {
      attached.node = null;
    }
  }
}

/** 把新树放进宿主：复用的节点 update（同宿主），新节点 mount；父先子后。 */
function placeSubtree(
  context: TreeApplyContext,
  node: MountedNode,
  host: TreeHost,
  index: number,
  attached?: { node: MountedNode | null },
): void {
  if (node.reusedFrom !== undefined) {
    invoke(node.path, () => {
      host.update(node.handle, index);
    });
  } else {
    invoke(node.path, () => {
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
    placeSubtree(context, child, childHost, childIndex);
  });
}

/** 后序卸载整棵子树（子先父后）；已卸过的节点跳过。 */
function releaseSubtree(context: TreeApplyContext, node: MountedNode): void {
  for (const child of node.children) {
    releaseSubtree(context, child);
  }
  releaseNode(context, node);
}

/** 回滚新建节点：按建树顺序逆序，保证子先父后。 */
function releaseFresh(context: TreeApplyContext, fresh: MountedNode[]): void {
  for (let index = fresh.length - 1; index >= 0; index -= 1) {
    const node = fresh[index];
    if (node !== undefined) {
      releaseNode(context, node);
    }
  }
}

function releaseNode(context: TreeApplyContext, node: MountedNode): void {
  if (node.released) {
    return;
  }
  node.released = true;
  try {
    node.renderer.unmount(node.node, node.output);
  } catch (error) {
    context.cleanup.push({
      code: "E-TREE-RENDER",
      path: node.path,
      message: "卸载渲染器失败: " + messageOf(error),
    });
  }
}

/** 从根宿主摘下整棵树；失败记诊断，不抛。 */
function detachRoot(context: TreeApplyContext, node: MountedNode): void {
  try {
    context.host.unmount(node.handle);
  } catch (error) {
    context.cleanup.push({
      code: "E-TREE-RENDER",
      path: node.path,
      message: "从根宿主摘下失败: " + messageOf(error),
    });
  }
}

/** 调外部实现（渲染器 / 宿主）；异常统一折成 E-TREE-RENDER 挂载中止。 */
function invoke<T>(path: string, operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    throw new TreeAbort([
      { code: "E-TREE-RENDER", path, message: "渲染 / 宿主调用失败: " + messageOf(error) },
    ]);
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

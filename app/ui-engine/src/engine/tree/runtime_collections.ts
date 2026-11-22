/**
 * data op 触发的集合 reconcile：只重算受影响 source 的实例，不整树 replace。
 *
 * 步长：同 key 的实例先比内容（order 是布局位置，不参与比较），内容没变就不进
 * changed——渲染器与 DOM 一个不动；变化的那一条只把实例子树里需要改 / 增 / 删的
 * 节点并进 changed，交给现有的 applyMountedUpdate 做最小更新。最后按数据顺序重排：
 * 位置没变的实例连宿主 update 都不发。实例 order 先给一个不冲突的大值，重排后再
 * 归位成 0..n-1。
 */

import type { Node as TreeNode } from "../../contract/tree_generated";
import type { AppliedDocument } from "./apply";
import { expandCollection } from "./collection";
import type { MountedNode } from "./runtime_apply";
import type { TreeRuntimeDiagnostic } from "./types";

export interface CollectionReconcile {
  readonly applied: AppliedDocument;
  readonly diagnostics: TreeRuntimeDiagnostic[];
  readonly collections: readonly {
    readonly mounted: MountedNode;
    /** 按数据顺序的实例根 id。 */
    readonly order: readonly string[];
  }[];
}

let orderSequence = 1_000_000;

/** 把受影响的 collection 按新数据展开，并合并进 applied 的 byId / changed。 */
export function mergeCollectionInstances(
  mountedById: ReadonlyMap<string, MountedNode>,
  applied: AppliedDocument,
  sources: ReadonlySet<string>,
): CollectionReconcile {
  const byId = new Map<string, TreeNode>(applied.byId);
  const diagnostics: TreeRuntimeDiagnostic[] = [];
  const collections: Array<{ mounted: MountedNode; order: string[] }> = [];
  const changed = new Set(applied.changed);
  for (const mounted of mountedById.values()) {
    const collection = mounted.node.collection;
    if (collection === undefined || !sources.has(collection.source)) {
      continue;
    }
    if (collection.virtual === true) {
      // 不实例化；只要让这个节点 update 一次，渲染器会用新数据重投影 items。
      changed.add(mounted.node.id);
      continue;
    }
    const expansion = expandCollection(mounted.node, collection, applied.document.data);
    diagnostics.push(...expansion.diagnostics);
    const current = new Map(mounted.children.map((child) => [child.node.id, child]));
    const order: string[] = [];
    for (const node of expansion.nodes) {
      orderSequence += 1;
      const next: TreeNode = { ...node, order: orderSequence };
      order.push(next.id);
      const old = current.get(next.id);
      if (old === undefined) {
        // 新 key：只记实例根，applyMountedUpdate 会把整棵实例子树一次建好。
        byId.set(next.id, next);
        changed.add(next.id);
        continue;
      }
      current.delete(next.id);
      if (sameContent(old.node, next)) {
        continue;
      }
      reconcileChanged(byId, changed, old.node, next);
    }
    // 剩下的旧实例是 key 消失：只记根，卸载时整棵子树一起走。
    for (const old of current.values()) {
      changed.add(old.node.id);
    }
    collections.push({ mounted, order });
  }
  return {
    applied: { ...applied, byId, changed: [...changed] },
    diagnostics,
    collections,
  };
}

/** 按数据顺序重排已挂载的实例；order 归位成 0..n-1，供下一批插入使用。 */
export function reorderCollections(
  collections: CollectionReconcile["collections"],
): TreeRuntimeDiagnostic[] {
  const diagnostics: TreeRuntimeDiagnostic[] = [];
  for (const { mounted, order } of collections) {
    const host = mounted.childHost;
    if (host === null) {
      continue;
    }
    const current = mounted.children;
    const byId = new Map(current.map((child) => [child.node.id, child]));
    const previous = new Map(current.map((child, index) => [child.node.id, index]));
    const ordered = order
      .map((id) => byId.get(id))
      .filter((child): child is MountedNode => child !== undefined);
    mounted.children = ordered;
    ordered.forEach((child, index) => {
      const moved = previous.get(child.node.id) !== index;
      child.node = { ...child.node, order: index };
      child.handle = { node: child.node, output: child.handle.output };
      if (!moved) {
        // 位置没变：宿主一个调用都不发，数据变化不该带来整列重排。
        return;
      }
      try {
        host.update(child.handle, index);
      } catch (error) {
        diagnostics.push({
          code: "E-TREE-RENDER",
          path: child.path,
          message: "集合重排失败: " + (error instanceof Error ? error.message : String(error)),
        });
      }
    });
  }
  return diagnostics;
}

/**
 * 内容变了的实例：新旧共有的节点记 update；新增节点只记最上层根（整棵子树一次建），
 * 消失的节点同样只记最上层根（整棵子树一次卸）。
 */
function reconcileChanged(
  byId: Map<string, TreeNode>,
  changed: Set<string>,
  oldRoot: TreeNode,
  nextRoot: TreeNode,
): void {
  const oldIds = new Set<string>();
  collectIds(oldRoot, oldIds);
  const newIds = new Set<string>();
  collectIds(nextRoot, newIds);
  collectNext(byId, changed, oldIds, nextRoot);
  collectGone(changed, newIds, oldRoot);
}

function collectNext(
  byId: Map<string, TreeNode>,
  changed: Set<string>,
  oldIds: ReadonlySet<string>,
  node: TreeNode,
): void {
  byId.set(node.id, node);
  changed.add(node.id);
  for (const child of node.layout) {
    if (oldIds.has(child.id)) {
      collectNext(byId, changed, oldIds, child);
      continue;
    }
    // 新增子树：byId 只需给根，运行时会按 layout 一次建好整棵。
    byId.set(child.id, child);
    changed.add(child.id);
  }
}

function collectGone(changed: Set<string>, newIds: ReadonlySet<string>, node: TreeNode): void {
  if (!newIds.has(node.id)) {
    changed.add(node.id);
    return;
  }
  for (const child of node.layout) {
    collectGone(changed, newIds, child);
  }
}

function collectIds(node: TreeNode, out: Set<string>): void {
  out.add(node.id);
  for (const child of node.layout) {
    collectIds(child, out);
  }
}

/** 实例内容是否等价；order 只表示布局位置，重排单独处理，不参与比较。 */
function sameContent(left: TreeNode, right: TreeNode): boolean {
  return (
    left.id === right.id &&
    left.chain === right.chain &&
    left.kind === right.kind &&
    left.title === right.title &&
    left.collection === undefined &&
    right.collection === undefined &&
    sameJson(left.slot, right.slot) &&
    sameJson(left.settings, right.settings) &&
    sameJson(left.bind, right.bind) &&
    sameJson(left.on, right.on) &&
    sameJson(left.emit, right.emit) &&
    sameJson(left.i18n, right.i18n) &&
    sameJson(left.a11y, right.a11y) &&
    left.layout.length === right.layout.length &&
    left.layout.every((child, index) => {
      const other = right.layout[index];
      return other !== undefined && sameContent(child, other);
    })
  );
}

/** JSON 值深比较：对象不看键序。data 条目与 settings 都是 JSON 数据。 */
function sameJson(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  if (typeof left !== "object" || typeof right !== "object" || left === null || right === null) {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => sameJson(item, right[index]))
    );
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  if (leftKeys.length !== Object.keys(rightRecord).length) {
    return false;
  }
  return leftKeys.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(rightRecord, key) &&
      sameJson(leftRecord[key], rightRecord[key]),
  );
}

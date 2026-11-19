/**
 * data op 触发的集合 reconcile：只重算受影响 source 的实例，不整树 replace。
 *
 * 做法是把新实例节点并进 applied.byId、把新增 / 删除 / 更新的实例 id 并进 changed，
 * 交给现有的 applyMountedUpdate 做最小挂载 / 更新 / 卸载；最后按数据顺序重排已有子节点。
 * 实例 order 先给一个不冲突的大值，重排后再归位成 0..n-1。
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
    readonly nodes: readonly TreeNode[];
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
  const collections: Array<{ mounted: MountedNode; nodes: readonly TreeNode[] }> = [];
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
    const oldIds = new Set(mounted.children.map((child) => child.node.id));
    const newIds = new Set(expansion.nodes.map((node) => node.id));
    const nodes = expansion.nodes.map((node) => {
      orderSequence += 1;
      const next: TreeNode = { ...node, order: orderSequence };
      byId.set(next.id, next);
      changed.add(next.id);
      return next;
    });
    for (const id of oldIds) {
      if (!newIds.has(id)) {
        changed.add(id);
      }
    }
    collections.push({ mounted, nodes });
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
  for (const { mounted, nodes } of collections) {
    const host = mounted.childHost;
    if (host === null) {
      continue;
    }
    const byId = new Map(mounted.children.map((child) => [child.node.id, child]));
    const ordered = nodes
      .map((node) => byId.get(node.id))
      .filter((child): child is MountedNode => child !== undefined);
    mounted.children = ordered;
    ordered.forEach((child, index) => {
      child.node = { ...child.node, order: index };
      child.handle = { node: child.node, output: child.handle.output };
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

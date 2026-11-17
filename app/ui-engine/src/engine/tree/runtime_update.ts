/**
 * 运行时最小更新：把文档层算好的新文档按“被触碰的子树根”落到已挂载树。
 *
 * 输入是 `applied.changed` 与最终文档（`applied.byId`），不重新 diff 新旧树：
 * - 旧有新无 → unmount；
 * - 旧无新有 → mount（新子树先全部建好再放）；
 * - 新旧都有 → setProps（只换节点引用 + update 渲染器）。
 *
 * 约束：一次批量里不允许嵌套 mount（新子树应自带子节点）；父节点必须已经挂载。
 * 构建失败会回滚已建的子树；宿主阶段的失败是 best effort（结构变更无法完整回滚）。
 */

import type { AppliedDocument } from "./apply";
import {
  buildDetachedSubtree,
  detachMountedSubtree,
  placeDetachedSubtree,
  type DetachedSubtree,
  type MountedNode,
  type TreeApplyContext,
} from "./runtime_apply";
import type { TreeHost, TreeRuntimeDiagnostic } from "./types";

export interface MountedUpdateState {
  byId: Map<string, MountedNode>;
  context: TreeApplyContext;
}

export type MountedUpdateResult =
  { ok: true; changed: string[] } | { ok: false; diagnostics: TreeRuntimeDiagnostic[] };

interface PlannedMount {
  next: MountedNode["node"];
  parent: MountedNode;
  host: TreeHost;
  index: number;
}

export function applyMountedUpdate(
  state: MountedUpdateState,
  applied: AppliedDocument,
): MountedUpdateResult {
  const { byId, context } = state;
  const removed: MountedNode[] = [];
  const added: string[] = [];
  const updated: string[] = [];
  for (const id of applied.changed) {
    const old = byId.get(id);
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
  // 先校验所有落点，再建子树：校验失败时还没有任何 DOM 改动。
  const planned: PlannedMount[] = [];
  const byDepth = (left: string, right: string): number =>
    depthOf(applied.byId.get(left)?.chain ?? "") - depthOf(applied.byId.get(right)?.chain ?? "");
  for (const id of [...added].sort(byDepth)) {
    const next = applied.byId.get(id);
    if (next === undefined) {
      continue;
    }
    const parentId = parentIdOf(next.chain);
    if (parentId === null || added.includes(parentId)) {
      return fail([
        {
          code: "E-PAYLOAD",
          path: "/ops",
          message: "一次批量里不要嵌套 mount；把子节点放进同一棵子树",
        },
      ]);
    }
    const parent = byId.get(parentId);
    if (parent === undefined) {
      return fail([
        { code: "E-TARGET-MISSING", path: "/ops", message: "父节点没有挂载: " + parentId },
      ]);
    }
    const host = parent.childHost;
    if (host === null) {
      return fail([
        { code: "E-TREE-HOST", path: "/ops", message: "父节点不接受子节点: " + parentId },
      ]);
    }
    const index = insertionIndex(parent, next.order);
    if (index < 0) {
      return fail([
        { code: "E-TREE-ORDER", path: "/ops", message: "同级 order 冲突: " + String(next.order) },
      ]);
    }
    planned.push({ next, parent, host, index });
  }
  const built: Array<PlannedMount & { subtree: DetachedSubtree }> = [];
  for (const plan of planned) {
    try {
      built.push({
        ...plan,
        subtree: buildDetachedSubtree(context, plan.next, plan.parent, "/ops"),
      });
    } catch (error) {
      for (const entry of built) {
        detachMountedSubtree(context, entry.subtree.root, entry.host);
      }
      return fail([...diagnosticsOfError(error), ...context.cleanup]);
    }
  }
  const appliedUpdates: Array<{
    mounted: MountedNode;
    previous: MountedNode["node"];
    next: MountedNode["node"];
  }> = [];
  const addedIds = new Set<string>();
  try {
    for (const node of removedRoots) {
      const parent = node.parent;
      if (parent === null) {
        return fail([{ code: "E-PAYLOAD", path: "/ops", message: "根不能卸载" }]);
      }
      const host = parent.childHost;
      if (host === null) {
        return fail([
          { code: "E-TREE-HOST", path: "/ops", message: "父节点不接受子节点: " + parent.node.id },
        ]);
      }
      const at = parent.children.indexOf(node);
      if (at >= 0) {
        parent.children.splice(at, 1);
      }
      detachMountedSubtree(context, node, host);
      for (const id of mountedIds(node)) {
        byId.delete(id);
      }
      reindex(parent, host);
    }
    for (const entry of built) {
      placeDetachedSubtree(context, entry.subtree, entry.host, entry.index);
      entry.parent.children.splice(entry.index, 0, entry.subtree.root);
      for (const [id, mounted] of entry.subtree.byId) {
        byId.set(id, mounted);
        addedIds.add(id);
      }
      reindex(entry.parent, entry.host);
    }
    for (const id of updated) {
      if (addedIds.has(id)) {
        continue;
      }
      const mounted = byId.get(id);
      const next = applied.byId.get(id);
      if (mounted === undefined || next === undefined) {
        continue;
      }
      appliedUpdates.push({ mounted, previous: mounted.node, next });
    }
    for (const update of appliedUpdates) {
      update.mounted.node = update.next;
      update.mounted.handle = { node: update.next, output: update.mounted.output };
      update.mounted.renderer.update(update.next, update.mounted.output);
    }
  } catch (error) {
    for (const update of [...appliedUpdates].reverse()) {
      update.mounted.node = update.previous;
      update.mounted.handle = { node: update.previous, output: update.mounted.output };
      try {
        update.mounted.renderer.update(update.previous, update.mounted.output);
      } catch {
        // 回滚也是 best effort；诊断里已经报了首次失败。
      }
    }
    return fail([...diagnosticsOfError(error), ...context.cleanup]);
  }
  return { ok: true, changed: applied.changed };
}

function fail(diagnostics: TreeRuntimeDiagnostic[]): MountedUpdateResult {
  return { ok: false, diagnostics };
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

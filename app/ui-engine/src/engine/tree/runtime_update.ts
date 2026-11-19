/**
 * 运行时最小更新：把文档层算好的新文档按“被触碰的子树根”落到已挂载树。
 *
 * 输入是 `applied.changed` 与最终文档（`applied.byId`），不重新 diff 新旧树：
 * - 旧有新无 → unmount；
 * - 旧无新有 → mount（新子树先全部建好再放）；
 * - 新旧都有 → setProps（只换节点引用 + update 渲染器）；
 * - replace → 先把旧子树摘下，再在同一个父节点下按 order 放新子树。
 *
 * data op 只写文档数据、不进 changed：这里没有对应的节点要 patch，自然跳过。
 *
 * 约束：一次批量里不允许嵌套 mount（新子树应自带子节点）；父节点必须已经挂载；
 * 一次批量只支持一个 replace（链式 replace 下一步再放开）。
 * 构建失败会回滚已建的子树；宿主阶段的失败是 best effort（结构变更无法完整回滚）。
 */

import type { Node } from "../../contract/tree_generated";
import type { AppliedDocument } from "./apply";
import type { OpsBatch } from "./ops";
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

interface PlannedBuild {
  next: Node;
  parent: MountedNode;
  host: TreeHost;
  /** replace 时被替换的旧节点；mount 时为空。 */
  old?: MountedNode;
}

export function applyMountedUpdate(
  state: MountedUpdateState,
  applied: AppliedDocument,
  batch: OpsBatch,
): MountedUpdateResult {
  const { byId, context } = state;
  const replaceOps = batch.ops.filter((op) => op.op === "replace");
  if (replaceOps.length > 1) {
    return fail([
      {
        code: "E-PAYLOAD",
        path: "/ops",
        message: "一次批量只支持一个 replace；链式 replace 下一步",
      },
    ]);
  }
  const handled = new Set<string>();
  let replacePlan: {
    old: MountedNode;
    next: Node | undefined;
    parent: MountedNode;
    host: TreeHost;
  } | null = null;
  const replaceOp = replaceOps[0];
  if (replaceOp !== undefined) {
    const old = byId.get(replaceOp.id);
    if (old !== undefined) {
      const parent = old.parent;
      if (parent === null) {
        return fail([{ code: "E-PAYLOAD", path: "/ops", message: "根不能 replace" }]);
      }
      const host = parent.childHost;
      if (host === null) {
        return fail([{ code: "E-TREE-HOST", path: "/ops", message: "父节点不接受子节点" }]);
      }
      const next = applied.byId.get(replaceOp.node.id);
      for (const id of mountedIds(old)) {
        handled.add(id);
      }
      if (next !== undefined) {
        for (const id of nodeIds(next)) {
          handled.add(id);
        }
      }
      replacePlan = { old, next, parent, host };
    }
  }
  const removed: MountedNode[] = [];
  const added: string[] = [];
  const updated: string[] = [];
  for (const id of applied.changed) {
    if (handled.has(id)) {
      continue;
    }
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
  const planned: PlannedBuild[] = [];
  if (replacePlan !== null && replacePlan.next !== undefined) {
    planned.push({
      next: replacePlan.next,
      parent: replacePlan.parent,
      host: replacePlan.host,
      old: replacePlan.old,
    });
  }
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
    planned.push({ next, parent, host });
  }
  const built: Array<PlannedBuild & { subtree: DetachedSubtree }> = [];
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
      removeMounted(context, node, parent, host, byId);
    }
    if (replacePlan !== null && replacePlan.next === undefined) {
      removeMounted(context, replacePlan.old, replacePlan.parent, replacePlan.host, byId);
    }
    for (const entry of built) {
      if (entry.old !== undefined) {
        removeMounted(context, entry.old, entry.parent, entry.host, byId);
      }
      const index = insertionIndex(entry.parent, entry.next.order);
      if (index < 0) {
        return fail([
          {
            code: "E-TREE-ORDER",
            path: "/ops",
            message: "同级 order 冲突: " + String(entry.next.order),
          },
        ]);
      }
      placeDetachedSubtree(context, entry.subtree, entry.host, index);
      entry.parent.children.splice(index, 0, entry.subtree.root);
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

function removeMounted(
  context: TreeApplyContext,
  node: MountedNode,
  parent: MountedNode,
  host: TreeHost,
  byId: Map<string, MountedNode>,
): void {
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

function nodeIds(node: Node): string[] {
  const ids = [node.id];
  for (const child of node.layout) {
    ids.push(...nodeIds(child));
  }
  for (const template of Object.values(node.collection?.templates ?? {})) {
    ids.push(...nodeIds(template));
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

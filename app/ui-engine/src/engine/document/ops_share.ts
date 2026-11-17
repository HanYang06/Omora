/**
 * ops 的结构共享：只沿被触碰节点的祖先路径复制，未触碰的兄弟保持原引用。
 *
 * 树里出现 collection.templates 时退回整棵深拷：模板不在 children 路径上，
 * 位置由 templates 命名表决定，按 children 祖先复制会漏掉模板子树。
 */

import type { SlotNode } from "../../contract/document";
import type { DocumentIndex } from "./document";
import type { WireOp } from "./ops";

function hasTemplates(node: SlotNode): boolean {
  if (node.collection !== undefined) {
    return true;
  }
  return node.children.some(hasTemplates);
}

/** 一条树 op 要触碰的 id / slot；route 不碰树。 */
function opTargets(op: WireOp): string[] {
  switch (op.op) {
    case "update":
    case "unmount":
    case "replace":
      return [op.id];
    case "mount":
      return [op.slot];
    case "move":
      return [op.id, op.slot];
    case "route":
      return [];
  }
}

/** 目标 + 全部祖先；任何目标不存在、或树里有模板就返回 undefined（退回深拷）。 */
function cloneIds(
  root: SlotNode,
  ops: readonly WireOp[],
  index: DocumentIndex,
): Set<string> | undefined {
  if (hasTemplates(root)) {
    return undefined;
  }
  const ids = new Set<string>();
  for (const op of ops) {
    for (const target of opTargets(op)) {
      if (index.get(target) === undefined) {
        return undefined;
      }
      let current: string | undefined = target;
      while (current !== undefined) {
        ids.add(current);
        current = index.parentOf(current)?.parentId;
      }
    }
  }
  return ids;
}

function cloneAlong(node: SlotNode, targets: ReadonlySet<string>): SlotNode {
  if (!targets.has(node.id)) {
    return node;
  }
  return { ...node, children: node.children.map((child) => cloneAlong(child, targets)) };
}

/** 一批 ops 的工作树：能共享就共享，不能就整棵深拷。 */
export function cloneForOps(
  root: SlotNode,
  ops: readonly WireOp[],
  index: DocumentIndex,
): SlotNode {
  const targets = cloneIds(root, ops, index);
  return targets === undefined ? structuredClone(root) : cloneAlong(root, targets);
}

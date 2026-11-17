/**
 * 视图 diff：形状 / 结构变化都尝试产出 ops；拿不准就返回 undefined 让调用方全量替换。
 *
 * 只处理 canProve 的部分：
 * - 同 id、kind、owner、layout / events / scope / bind / in / reactions / grant 不变；
 * - props 可增改，不能删（update 只能浅合并）；
 * - children 可增删 / 重排，用 mount / unmount / move；
 * - collection / layout / events 等元数据变化用整节点 replace；模板字段变化仍靠试跑兜底。
 *
 * 顺序：父节点先出 update / 结构 op，再递归公共子节点；调用方会用纯 applyOps
 * 试跑并按终态是否等于新树来兜底。
 */

import type { SlotNode } from "../contract/document";
import type { WireOp } from "../engine/document/ops";

function sameValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => sameValue(item, right[index]))
    );
  }
  if (typeof left === "object" && left !== null && typeof right === "object" && right !== null) {
    const leftRecord = left as Record<string, unknown>;
    const rightRecord = right as Record<string, unknown>;
    const keys = Object.keys(leftRecord);
    return (
      keys.length === Object.keys(rightRecord).length &&
      keys.every((key) => key in rightRecord && sameValue(leftRecord[key], rightRecord[key]))
    );
  }
  return false;
}

function sameOptional(left: unknown, right: unknown): boolean {
  return sameValue(left ?? null, right ?? null);
}

/** 终态比较：调用方只在试跑结果与新树完全一致时才提交 ops。 */
export function sameTree(left: SlotNode, right: SlotNode): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** 视图树 → ops；任何无法证明等价的变化返回 undefined。 */
export function viewOps(oldRoot: SlotNode, newRoot: SlotNode): WireOp[] | undefined {
  const ops: WireOp[] = [];
  return diffNode(oldRoot, newRoot, ops) ? ops : undefined;
}

function propChanges(
  oldProps: Record<string, unknown>,
  newProps: Record<string, unknown>,
): Record<string, unknown> | undefined {
  for (const key of Object.keys(oldProps)) {
    if (!(key in newProps)) {
      return undefined;
    }
  }
  const changed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(newProps)) {
    if (!sameValue(oldProps[key], value)) {
      changed[key] = value;
    }
  }
  return changed;
}

function diffNode(oldNode: SlotNode, newNode: SlotNode, ops: WireOp[]): boolean {
  if (oldNode.id !== newNode.id) {
    return false;
  }
  const metadataChanged =
    oldNode.kind !== newNode.kind ||
    oldNode.owner !== newNode.owner ||
    oldNode.collection !== undefined ||
    newNode.collection !== undefined ||
    !sameOptional(oldNode.layout, newNode.layout) ||
    !sameOptional(oldNode.events, newNode.events) ||
    !sameOptional(oldNode.scope, newNode.scope) ||
    !sameOptional(oldNode.bind, newNode.bind) ||
    !sameOptional(oldNode.in, newNode.in) ||
    !sameOptional(oldNode.reactions, newNode.reactions) ||
    !sameOptional(oldNode.grant, newNode.grant);
  if (metadataChanged) {
    // 元数据 / collection 变化用整节点 replace；新子树 id 冲突等问题由调用方试跑兜底。
    ops.push({ op: "replace", id: oldNode.id, node: newNode });
    return true;
  }
  const patch = propChanges(oldNode.props, newNode.props);
  if (patch === undefined) {
    return false;
  }
  if (Object.keys(patch).length > 0) {
    ops.push({ op: "update", id: oldNode.id, props: patch });
  }

  const newIds = newNode.children.map((child) => child.id);
  const newSet = new Set(newIds);
  for (const child of oldNode.children) {
    if (!newSet.has(child.id)) {
      ops.push({ op: "unmount", id: child.id });
    }
  }
  const current = oldNode.children.map((child) => child.id).filter((id) => newSet.has(id));
  for (let index = 0; index < newIds.length; index += 1) {
    const targetId = newIds[index];
    const newChild = newNode.children[index];
    if (targetId === undefined || newChild === undefined) {
      return false;
    }
    const at = current.indexOf(targetId);
    if (at === -1) {
      ops.push({ op: "mount", slot: oldNode.id, at: index, node: newChild });
      current.splice(index, 0, targetId);
    } else if (at !== index) {
      ops.push({ op: "move", id: targetId, slot: oldNode.id, at: index });
      current.splice(at, 1);
      current.splice(index, 0, targetId);
    }
  }

  for (const newChild of newNode.children) {
    const oldChild = oldNode.children.find((child) => child.id === newChild.id);
    if (oldChild !== undefined && !diffNode(oldChild, newChild, ops)) {
      return false;
    }
  }
  return true;
}

/**
 * 视图 diff 的最小版本：形状不变、只改 props 时产出 update ops。
 *
 * 结构 / kind / layout / events / collection 任何变化都返回 undefined，让调用方
 * 退回全量 applyFull。这样主会话先吃到“纯内容变化”的增量，不冒险猜结构。
 */

import type { SlotNode } from "../contract/document";

export interface PropUpdate {
  op: "update";
  id: string;
  props: Record<string, unknown>;
}

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

/** 形状不变时收集 props update；形状变了返回 undefined。 */
export function propUpdates(oldRoot: SlotNode, newRoot: SlotNode): PropUpdate[] | undefined {
  const updates: PropUpdate[] = [];
  if (!walk(oldRoot, newRoot, updates)) {
    return undefined;
  }
  return updates;
}

function walk(oldNode: SlotNode, newNode: SlotNode, updates: PropUpdate[]): boolean {
  if (
    oldNode.id !== newNode.id ||
    oldNode.kind !== newNode.kind ||
    oldNode.owner !== newNode.owner ||
    oldNode.collection !== undefined ||
    newNode.collection !== undefined ||
    oldNode.children.length !== newNode.children.length ||
    !sameOptional(oldNode.layout, newNode.layout) ||
    !sameOptional(oldNode.events, newNode.events) ||
    !sameOptional(oldNode.scope, newNode.scope) ||
    !sameOptional(oldNode.bind, newNode.bind) ||
    !sameOptional(oldNode.in, newNode.in) ||
    !sameOptional(oldNode.reactions, newNode.reactions) ||
    !sameOptional(oldNode.grant, newNode.grant)
  ) {
    return false;
  }
  const oldProps = oldNode.props;
  const newProps = newNode.props;
  const changed: Record<string, unknown> = {};
  let dirty = false;
  for (const key of Object.keys(oldProps)) {
    if (!(key in newProps)) {
      return false;
    }
  }
  for (const [key, value] of Object.entries(newProps)) {
    if (!sameValue(oldProps[key], value)) {
      changed[key] = value;
      dirty = true;
    }
  }
  if (dirty) {
    updates.push({ op: "update", id: oldNode.id, props: changed });
  }
  for (let index = 0; index < oldNode.children.length; index += 1) {
    const oldChild = oldNode.children[index];
    const newChild = newNode.children[index];
    if (oldChild === undefined || newChild === undefined) {
      return false;
    }
    if (!walk(oldChild, newChild, updates)) {
      return false;
    }
  }
  return true;
}

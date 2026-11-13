/**
 * ops 的树修改实现（内部模块）：每个 op 在深拷出来的工作树上就地修改。
 *
 * 调用方（ops.ts 的 applyOps）负责版本校验、深拷与原子性：任何一步失败都会丢掉
 * 整棵工作树，所以这里不需要单独回滚，失败只返回一条诊断。
 *
 * 结构操作（mount / move / unmount / replace）只作用于 children 树里的节点；
 * collection.templates 里的节点可以按 id update 内容，但位置由命名表决定，
 * 对它们做结构操作返回 E-PAYLOAD。理由与语义见 ops.ts 文件头。
 */

import type { Capacity, SlotNode } from "../contract/document";
import type { Diagnostic, DiagnosticCode } from "../link/types";
import type { DocumentIndex } from "./document";
import { makeDiagnostic } from "./diagnostics";
import type { MountOp, MoveOp, Op, ReplaceOp, UnmountOp, UpdateOp } from "./ops";

/** 工作树：applyOps 里深拷出来的根；replace 根时换掉整个引用。 */
export interface Working {
  root: SlotNode;
}

/** children 树里的位置：parent 为 undefined 表示根。 */
export interface LiveLocation {
  parent: SlotNode | undefined;
  order: number;
}

export type LiveLocations = Map<string, LiveLocation>;

/** 只有 children 树里的节点可做结构操作；模板子树不在 live 表里。 */
export function buildLiveLocations(root: SlotNode): LiveLocations {
  const live: LiveLocations = new Map();
  const visit = (node: SlotNode, parent: SlotNode | undefined, order: number): void => {
    live.set(node.id, { parent, order });
    node.children.forEach((child, index) => {
      visit(child, node, index);
    });
  };
  visit(root, undefined, -1);
  return live;
}

export interface OpContext {
  working: Working;
  index: DocumentIndex;
  live: LiveLocations;
}

export type OpOutcome = { ok: true; touched: string } | { ok: false; diagnostic: Diagnostic };

function failure(
  code: DiagnosticCode,
  message: string,
  fields: { owner?: string; slot?: string; path?: string } = {},
): OpOutcome {
  return { ok: false, diagnostic: makeDiagnostic(code, message, fields) };
}

/** 目标存在但位于模板子树：位置来自 templates 命名表，不能用结构操作改。 */
function templateFailure(id: string, path: string): OpOutcome {
  return failure("E-PAYLOAD", "模板子树里的节点不能做结构操作: " + id, { slot: id, path });
}

/** 收集一棵子树里全部可寻址 id（children + collection.templates）。 */
function collectIds(node: SlotNode, out: string[]): void {
  out.push(node.id);
  for (const child of node.children) {
    collectIds(child, out);
  }
  if (node.collection !== undefined) {
    for (const template of Object.values(node.collection.templates)) {
      collectIds(template, out);
    }
  }
}

function capacityViolated(capacity: Capacity | undefined, count: number): boolean {
  return (capacity === "none" && count > 0) || (capacity === "one" && count > 1);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

/** node 自身或其某个后代是不是 id。 */
function containsNode(node: SlotNode, id: string): boolean {
  if (node.id === id) {
    return true;
  }
  return node.children.some((child) => containsNode(child, id));
}

function capacityMessage(subject: string, capacity: Capacity, count: number): string {
  return subject + " 的 capacity 是 " + capacity + "，却有 " + String(count) + " 个子节点";
}

/** update：浅合并 props；不改位置，因此允许模板内节点。 */
function applyUpdate(ctx: OpContext, op: UpdateOp, path: string): OpOutcome {
  const target = ctx.index.get(op.id);
  if (target === undefined) {
    return failure("E-TARGET-MISSING", "更新目标不存在: " + op.id, {
      slot: op.id,
      path: path + ".id",
    });
  }
  target.props = { ...target.props, ...op.props };
  return { ok: true, touched: op.id };
}

/** mount：往 slot.children 的 at 处插一棵新子树（at 缺省尾部、越界夹住）。 */
function applyMount(ctx: OpContext, op: MountOp, path: string): OpOutcome {
  const slotNode = ctx.index.get(op.slot);
  if (slotNode === undefined) {
    return failure("E-TARGET-MISSING", "挂载目标槽不存在: " + op.slot, {
      slot: op.slot,
      path: path + ".slot",
    });
  }
  if (!ctx.live.has(op.slot)) {
    return templateFailure(op.slot, path + ".slot");
  }
  const nodeIds: string[] = [];
  collectIds(op.node, nodeIds);
  for (const id of nodeIds) {
    if (ctx.index.get(id) !== undefined) {
      return failure("E-ID-DUPLICATE", "新子树 id 与现存文档冲突: " + id, {
        slot: op.slot,
        path: path + ".node",
      });
    }
  }
  const parentCount = slotNode.children.length + 1;
  const parentCapacity = slotNode.layout?.capacity;
  if (parentCapacity !== undefined && capacityViolated(parentCapacity, parentCount)) {
    return failure(
      "E-SLOT-CAPACITY",
      capacityMessage("slot " + op.slot, parentCapacity, parentCount),
      { slot: op.slot, path: path + ".slot" },
    );
  }
  const nodeCapacity = op.node.layout?.capacity;
  if (nodeCapacity !== undefined && capacityViolated(nodeCapacity, op.node.children.length)) {
    return failure(
      "E-SLOT-CAPACITY",
      capacityMessage("新子树根 " + op.node.id, nodeCapacity, op.node.children.length),
      { slot: op.node.id, path: path + ".node" },
    );
  }
  const at = clamp(op.at ?? slotNode.children.length, 0, slotNode.children.length);
  const clone = structuredClone(op.node);
  slotNode.children.splice(at, 0, clone);
  return { ok: true, touched: clone.id };
}

/** move：先删后插；同父同位置是允许的 no-op。 */
function applyMove(ctx: OpContext, op: MoveOp, path: string): OpOutcome {
  const node = ctx.index.get(op.id);
  if (node === undefined) {
    return failure("E-TARGET-MISSING", "移动目标不存在: " + op.id, {
      slot: op.id,
      path: path + ".id",
    });
  }
  const target = ctx.index.get(op.slot);
  if (target === undefined) {
    return failure("E-TARGET-MISSING", "移动目标槽不存在: " + op.slot, {
      slot: op.slot,
      path: path + ".slot",
    });
  }
  const source = ctx.live.get(op.id);
  if (source === undefined) {
    return templateFailure(op.id, path + ".id");
  }
  if (!ctx.live.has(op.slot)) {
    return templateFailure(op.slot, path + ".slot");
  }
  if (containsNode(node, op.slot)) {
    return failure("E-CYCLE", "不能把 " + op.id + " 移进自己的子树: " + op.slot, {
      slot: op.slot,
      path,
    });
  }
  const sourceParent = source.parent;
  if (sourceParent === undefined) {
    return failure("E-PAYLOAD", "根不能移动", { slot: op.id, path: path + ".id" });
  }
  const sameParent = sourceParent === target;
  const lengthAfterRemoval = sameParent ? target.children.length - 1 : target.children.length;
  const at = clamp(op.at, 0, lengthAfterRemoval);
  if (sameParent && source.order === at) {
    return { ok: true, touched: op.id };
  }
  const newCount = lengthAfterRemoval + 1;
  const capacity = target.layout?.capacity;
  if (capacity !== undefined && capacityViolated(capacity, newCount)) {
    return failure("E-SLOT-CAPACITY", capacityMessage("slot " + op.slot, capacity, newCount), {
      slot: op.slot,
      path: path + ".slot",
    });
  }
  sourceParent.children.splice(source.order, 1);
  target.children.splice(at, 0, node);
  return { ok: true, touched: op.id };
}

/** unmount：删整棵子树；根不能卸。 */
function applyUnmount(ctx: OpContext, op: UnmountOp, path: string): OpOutcome {
  const target = ctx.index.get(op.id);
  if (target === undefined) {
    return failure("E-TARGET-MISSING", "卸载目标不存在: " + op.id, {
      slot: op.id,
      path: path + ".id",
    });
  }
  if (op.id === ctx.working.root.id) {
    return failure("E-PAYLOAD", "根不能卸载", { slot: op.id, path: path + ".id" });
  }
  const location = ctx.live.get(op.id);
  if (location === undefined) {
    return templateFailure(op.id, path + ".id");
  }
  const parent = location.parent;
  if (parent === undefined) {
    return failure("E-PAYLOAD", "根不能卸载", { slot: op.id, path: path + ".id" });
  }
  parent.children.splice(location.order, 1);
  return { ok: true, touched: op.id };
}

/** replace：原位换整棵子树；新 id 只需与「移除旧子树后剩余的文档」不冲突。 */
function applyReplace(ctx: OpContext, op: ReplaceOp, path: string): OpOutcome {
  const target = ctx.index.get(op.id);
  if (target === undefined) {
    return failure("E-TARGET-MISSING", "替换目标不存在: " + op.id, {
      slot: op.id,
      path: path + ".id",
    });
  }
  const location = ctx.live.get(op.id);
  if (location === undefined) {
    return templateFailure(op.id, path + ".id");
  }
  const removed: string[] = [];
  collectIds(target, removed);
  const removedIds = new Set<string>(removed);
  const nextIds: string[] = [];
  collectIds(op.node, nextIds);
  const seen = new Set<string>();
  for (const id of nextIds) {
    if (seen.has(id)) {
      return failure("E-ID-DUPLICATE", "新子树内部重复 id: " + id, {
        slot: op.node.id,
        path: path + ".node",
      });
    }
    seen.add(id);
  }
  for (const id of nextIds) {
    if (!removedIds.has(id) && ctx.index.get(id) !== undefined) {
      return failure("E-ID-DUPLICATE", "新子树 id 与剩余文档冲突: " + id, {
        slot: op.id,
        path: path + ".node",
      });
    }
  }
  const capacity = op.node.layout?.capacity;
  if (capacity !== undefined && capacityViolated(capacity, op.node.children.length)) {
    return failure(
      "E-SLOT-CAPACITY",
      capacityMessage("新子树根 " + op.node.id, capacity, op.node.children.length),
      { slot: op.node.id, path: path + ".node" },
    );
  }
  const clone = structuredClone(op.node);
  const parent = location.parent;
  if (parent === undefined) {
    ctx.working.root = clone;
  } else {
    parent.children[location.order] = clone;
  }
  return { ok: true, touched: clone.id };
}

/** 应用一条 op；调用方负责丢弃失败后的整棵工作树。 */
export function applyOp(ctx: OpContext, op: Op, path: string): OpOutcome {
  switch (op.op) {
    case "update":
      return applyUpdate(ctx, op, path);
    case "mount":
      return applyMount(ctx, op, path);
    case "move":
      return applyMove(ctx, op, path);
    case "unmount":
      return applyUnmount(ctx, op, path);
    case "replace":
      return applyReplace(ctx, op, path);
  }
}

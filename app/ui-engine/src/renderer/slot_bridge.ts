/**
 * Slot → DOM 渲染的薄桥（S3-d）。
 *
 * 只改形状、不做任何渲染决策或数据展开：
 * - `type = slot.kind`，保留命名空间（交给 `slotRegistry` 找实现：`dendro:<type>`
 *   别名复用 legacy kind，Slot 原生结构 kind 在 kinds.ts）；
 * - 复制 id / props / children / events / layout 这几个渲染层认识的字段；
 * - **不展开 `collection.templates`**：模板不是挂载节点，实例化是运行时
 *   （`engine/collections/collection.ts`）的职责；桥只搬 `slot.children`，模板永远不进 DOM。
 *
 * 入参不被改写；props / children / events / layout 是浅拷贝（props 里的值对象
 * 仍共享引用——渲染器只读 props，不需要深拷）。
 */

import type { Layout, SlotNode } from "../contract/document";
import type { Node } from "./types";

function copyLayout(layout: Layout): Layout {
  const copy: Layout = { flow: layout.flow, capacity: layout.capacity };
  if (layout.size !== undefined) {
    copy.size = { ...layout.size };
  }
  if (layout.gap !== undefined) {
    copy.gap = layout.gap;
  }
  if (layout.align !== undefined) {
    copy.align = layout.align;
  }
  if (layout.scroll !== undefined) {
    copy.scroll = layout.scroll;
  }
  return copy;
}

/**
 * Slot → legacy Node 的缓存：同一个 Slot 对象得到同一个 Node 对象，渲染器的
 * `candidate.node === node` memo 才能跨 apply 复用；ops 路径复制没碰到的子树
 * 保持原引用，于是整棵跳过。
 *
 * 契约：Slot 节点不可原地改。ops / data 都返回新节点，旧 Slot 不会被改写。
 */
const nodeCache = new WeakMap<SlotNode, Node>();

/** Slot → legacy Node：同一个 kind 名、同一条 children 链，附带 layout。 */
export function slotToNode(slot: SlotNode): Node {
  const cached = nodeCache.get(slot);
  if (cached !== undefined) {
    return cached;
  }
  const node: Node = {
    type: slot.kind,
    id: slot.id,
    props: { ...slot.props },
    children: slot.children.map(slotToNode),
  };
  if (slot.events !== undefined) {
    node.events = { ...slot.events };
  }
  if (slot.layout !== undefined) {
    node.layout = copyLayout(slot.layout);
  }
  nodeCache.set(slot, node);
  return node;
}

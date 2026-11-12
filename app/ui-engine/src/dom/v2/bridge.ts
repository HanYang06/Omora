/**
 * v2 Slot → DOM 渲染的薄桥（S3-d）。
 *
 * 只改形状、不做任何渲染决策或数据展开：
 * - `type = slot.kind`，保留命名空间（交给 `v2Registry` 找实现：`dendro:<type>`
 *   别名复用 v1 kind，v2 原生结构 kind 在 kinds.ts）；
 * - 复制 id / props / children / events / layout 这几个渲染层认识的字段；
 * - **不展开 `collection.templates`**：模板不是挂载节点，实例化是运行时
 *   （`runtime/collection.ts`）的职责；桥只搬 `slot.children`，模板永远不进 DOM。
 *
 * 入参不被改写；props / children / events / layout 是浅拷贝（props 里的值对象
 * 仍共享引用——渲染器只读 props，不需要深拷）。
 */

import type { Layout, SlotNode } from "../../core/document";
import type { Node } from "../../core/types";

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

/** v2 Slot → v1 Node：同一个 kind 名、同一条 children 链，附带 layout。 */
export function slotToNode(slot: SlotNode): Node {
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
  return node;
}

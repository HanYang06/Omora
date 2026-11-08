/**
 * 界面节点。形状是合同：Python 的 sdk/ui.py serialize() 产出的就是它。
 *
 * props 对渲染引擎不透明；可调用字段（如 on_click）已经序列化成 handler id。
 */
export interface Node {
  type: string;
  props: Record<string, unknown>;
  children: Node[];
}

export type NodeTree = Node[];

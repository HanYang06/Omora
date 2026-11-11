import { memo, type ReactNode } from "react";
import { components } from "./components";
import type { EventHandler, MediaResolver, Node } from "../core/types";

/**
 * 节点数据 → React 元素。
 *
 * 每个节点外面套一层 memo，比较的是节点数据的**引用**：补丁应用后没变的子树保持
 * 同一个对象（见 `patch.ts`），memo 因此直接跳过这棵子树——组件不重画，children
 * 也不重建。整棵重建会让这条路径失效。
 *
 * key 用位置（下标）而不是节点引用：补丁必然沿着从根到改动点的路径克隆节点，
 * 如果按引用给 key，根节点一变就会把整棵树重新挂载，memo 白做。
 */

interface NodeViewProps {
  node: Node;
  onEvent?: EventHandler;
  loadMedia?: MediaResolver;
}

function NodeView({ node, onEvent, loadMedia }: NodeViewProps): ReactNode {
  const type = typeof node.type === "string" ? node.type : "";
  const Component = components[type];
  if (Component === undefined) {
    console.warn("[omora] 未知组件类型:", type || "(空)");
    return <UnknownNode type={type} />;
  }

  const children = Array.isArray(node.children) ? node.children : [];
  return (
    <Component node={node} onEvent={onEvent} loadMedia={loadMedia}>
      {renderTree(children, onEvent, loadMedia)}
    </Component>
  );
}

/** 只有节点数据引用与两个回调都没变时才跳过。 */
const MemoNode = memo(NodeView);

/** 节点数组 → React 节点数组。children 一律按数组处理。 */
export function renderTree(
  nodes: Node[],
  onEvent?: EventHandler,
  loadMedia?: MediaResolver,
): ReactNode[] {
  const list = Array.isArray(nodes) ? nodes : [];
  return list.map((node, index) => {
    if (node === null || typeof node !== "object") {
      console.warn("[omora] 节点必须是对象:", node);
      return <UnknownNode key={String(index)} type="" />;
    }
    return <MemoNode key={String(index)} node={node} onEvent={onEvent} loadMedia={loadMedia} />;
  });
}

function UnknownNode({ type }: { type: string }): ReactNode {
  return (
    <div className="omora-unknown" data-unknown-type={type}>
      {`未知组件: ${type || "(空)"}`}
    </div>
  );
}

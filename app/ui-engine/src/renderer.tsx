import type { ReactNode } from "react";
import { components } from "./components";
import type { Node } from "./types";

export type EventHandler = (handler: string) => void;

/** 节点数组 → React 节点数组。children 一律按数组处理。 */
export function renderTree(nodes: Node[], onEvent?: EventHandler): ReactNode[] {
  const list = Array.isArray(nodes) ? nodes : [];
  return list.map((node, index) => renderNode(node, String(index), onEvent));
}

function renderNode(
  node: Node | null | undefined,
  key: string,
  onEvent?: EventHandler,
): ReactNode {
  if (node === null || typeof node !== "object") {
    console.warn("[omora] 节点必须是对象:", node);
    return <UnknownNode key={key} type="" />;
  }

  const type = typeof node.type === "string" ? node.type : "";
  const Component = components[type];

  if (Component === undefined) {
    console.warn(`[omora] 未知组件类型: ${type || "(空)"}`);
    return <UnknownNode key={key} type={type} />;
  }

  const children = Array.isArray(node.children) ? node.children : [];

  return (
    <Component key={key} node={node} onEvent={onEvent}>
      {renderTree(children, onEvent)}
    </Component>
  );
}

function UnknownNode({ type }: { type: string }): ReactNode {
  return (
    <div className="omora-unknown" data-unknown-type={type}>
      {`未知组件: ${type || "(空)"}`}
    </div>
  );
}

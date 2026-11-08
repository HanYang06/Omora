import type { ComponentType, ReactNode } from "react";
import type { Node } from "./types";

export interface NodeComponentProps {
  node: Node;
  onEvent?: (handler: string) => void;
  children?: ReactNode;
}

function textOf(node: Node): string {
  const value = node.props?.text;
  return typeof value === "string" ? value : "";
}

/** column：纵向 flex。 */
export function Column({ children }: NodeComponentProps): ReactNode {
  return (
    <div className="omora-column" data-type="column">
      {children}
    </div>
  );
}

/** row：横向 flex。 */
export function Row({ children }: NodeComponentProps): ReactNode {
  return (
    <div className="omora-row" data-type="row">
      {children}
    </div>
  );
}

/** text：span；kind 只映射样式类（v0：title / 默认）。 */
export function Text({ node }: NodeComponentProps): ReactNode {
  const kind = typeof node.props?.kind === "string" ? node.props.kind : undefined;
  const className = kind === "title" ? "omora-text omora-text--title" : "omora-text";
  return (
    <span className={className} data-type="text" data-kind={kind ?? "body"}>
      {textOf(node)}
    </span>
  );
}

/** button：props.on_click 是 handler id；点击把 id 交给 onEvent。 */
export function Button({ node, onEvent }: NodeComponentProps): ReactNode {
  const handler = node.props?.on_click;
  const clickable = typeof handler === "string" && handler.length > 0;

  return (
    <button
      type="button"
      className="omora-button"
      data-type="button"
      data-handler={clickable ? handler : undefined}
      disabled={!clickable}
      onClick={() => {
        if (typeof handler === "string" && handler.length > 0) {
          onEvent?.(handler);
        }
      }}
    >
      {textOf(node)}
    </button>
  );
}

/** 组件注册表。未知 type 由 renderer 画占位框。 */
export const components: Record<string, ComponentType<NodeComponentProps>> = {
  column: Column,
  row: Row,
  text: Text,
  button: Button,
};

import type { CSSProperties, ReactElement } from "react";

import type { WidgetProps } from "../types";

const STACK_STYLE: CSSProperties = { display: "flex", minWidth: 0 };

export function StackWidget({ node, context }: WidgetProps): ReactElement | null {
  if (node.type !== "Stack") {
    return null;
  }
  const direction = node.props.direction ?? "vertical";
  const style: CSSProperties = {
    ...STACK_STYLE,
    flexDirection: direction === "horizontal" ? "row" : "column",
  };
  if (node.props.gap !== undefined) {
    style.gap = node.props.gap;
  }
  return (
    <div data-widget="Stack" data-direction={direction} style={style}>
      {context.renderNodes(node.children ?? [], context.scope)}
    </div>
  );
}

import { Fragment, type CSSProperties, type ReactElement } from "react";

import { resolveItems, resolveText, withItem } from "../binding";
import type { WidgetProps } from "../types";

const LIST_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--omora-space-xs)",
};

export function ListWidget({ node, context }: WidgetProps): ReactElement | null {
  if (node.type !== "List") {
    return null;
  }
  const items = resolveItems(node.props.items, context.scope);
  const template = node.children ?? [];
  if (items.length === 0) {
    return (
      <div data-widget="List" style={LIST_STYLE}>
        {resolveText(node.props.emptyText ?? "", context.scope)}
      </div>
    );
  }
  return (
    <div data-widget="List" style={LIST_STYLE}>
      {items.map((item, index) => (
        <Fragment key={index}>
          {context.renderNodes(template, withItem(context.scope, item))}
        </Fragment>
      ))}
    </div>
  );
}

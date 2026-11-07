import type { CSSProperties, ReactElement } from "react";

import { resolveText } from "../binding";
import type { WidgetProps } from "../types";

const CARD_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--omora-space-sm)",
  padding: "var(--omora-space-md)",
  border: "1px solid var(--omora-color-border)",
  borderRadius: "var(--omora-radius-md)",
  background: "var(--omora-color-surface-raised)",
};

const HEADER_STYLE: CSSProperties = { fontWeight: 600 };

export function CardWidget({ node, context }: WidgetProps): ReactElement | null {
  if (node.type !== "Card") {
    return null;
  }
  const title = node.props.title;
  return (
    <section data-widget="Card" style={CARD_STYLE}>
      {title === undefined ? null : (
        <header style={HEADER_STYLE}>{resolveText(title, context.scope)}</header>
      )}
      {context.renderNodes(node.children ?? [], context.scope)}
    </section>
  );
}

import type { CSSProperties, ReactElement } from "react";

import type { C3Node } from "../../contract";
import { resolveText } from "../binding";
import type { WidgetProps } from "../types";

type TextVariant = NonNullable<Extract<C3Node, { type: "Text" }>["props"]["variant"]>;

const TEXT_STYLE: CSSProperties = { margin: 0 };

const VARIANT_STYLES: Record<TextVariant, CSSProperties> = {
  title: { fontSize: "1.5rem", fontWeight: 600, lineHeight: 1.25 },
  subtitle: { fontSize: "1.125rem", fontWeight: 600, lineHeight: 1.3 },
  body: { fontSize: "1rem", lineHeight: 1.5 },
  caption: { fontSize: "0.875rem", lineHeight: 1.4 },
  mono: { fontFamily: "var(--omora-font-mono)", fontSize: "0.875rem" },
};

export function TextWidget({ node, context }: WidgetProps): ReactElement | null {
  if (node.type !== "Text") {
    return null;
  }
  const variant = node.props.variant ?? "body";
  return (
    <span
      data-widget="Text"
      data-variant={variant}
      style={{ ...TEXT_STYLE, ...VARIANT_STYLES[variant] }}
    >
      {resolveText(node.props.text, context.scope)}
    </span>
  );
}

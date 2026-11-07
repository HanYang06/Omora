import type { CSSProperties, ReactElement } from "react";

import { resolveText } from "../binding";
import { resolveCommand } from "../command";
import type { WidgetProps } from "../types";

const BUTTON_STYLE: CSSProperties = { font: "inherit", cursor: "pointer" };

export function ButtonWidget({ node, context }: WidgetProps): ReactElement | null {
  if (node.type !== "Button") {
    return null;
  }
  const handleClick = (): void => {
    const command = resolveCommand(node.on?.click, context.scope);
    if (command !== null) {
      context.onCommand?.(command);
    }
  };
  return (
    <button
      type="button"
      data-widget="Button"
      data-variant={node.props.variant ?? "default"}
      disabled={node.props.disabled ?? false}
      onClick={handleClick}
      style={BUTTON_STYLE}
    >
      {resolveText(node.props.label, context.scope)}
    </button>
  );
}

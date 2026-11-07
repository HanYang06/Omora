import {
  useState,
  type ChangeEvent,
  type CSSProperties,
  type KeyboardEvent,
  type ReactElement,
} from "react";

import { resolveText, withValue } from "../binding";
import { resolveCommand } from "../command";
import type { NodeContext, NodeOf, WidgetProps } from "../types";

const INPUT_STYLE: CSSProperties = { font: "inherit" };

export function InputWidget({ node, context }: WidgetProps): ReactElement | null {
  if (node.type !== "Input") {
    return null;
  }
  return <InputControl node={node} context={context} />;
}

interface InputControlProps {
  node: NodeOf<"Input">;
  context: NodeContext;
}

function InputControl({ node, context }: InputControlProps): ReactElement {
  const [value, setValue] = useState(() => resolveText(node.props.value ?? "", context.scope));

  const handleChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const next = event.target.value;
    setValue(next);
    const command = resolveCommand(node.on?.change, withValue(context.scope, next));
    if (command !== null) {
      context.onCommand?.(command);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key !== "Enter") {
      return;
    }
    const command = resolveCommand(node.on?.submit, withValue(context.scope, value));
    if (command !== null) {
      context.onCommand?.(command);
    }
  };

  return (
    <input
      type="text"
      data-widget="Input"
      value={value}
      placeholder={resolveText(node.props.placeholder ?? "", context.scope)}
      disabled={node.props.disabled ?? false}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      style={INPUT_STYLE}
    />
  );
}

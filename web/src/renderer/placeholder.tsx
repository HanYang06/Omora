import type { CSSProperties, ReactElement } from "react";

export interface PlaceholderProps {
  type: string;
}

const PLACEHOLDER_STYLE: CSSProperties = {
  padding: "var(--omora-space-sm)",
  border: "1px dashed currentColor",
  borderRadius: "var(--omora-radius-md)",
  opacity: 0.6,
};

export function Placeholder({ type }: PlaceholderProps): ReactElement {
  return (
    <div data-omora-placeholder={type} style={PLACEHOLDER_STYLE}>
      不支持的组件类型:{type}
    </div>
  );
}

import type { CSSProperties, ReactElement } from "react";

import type { CmdInvokeParams } from "../contract";
import { NodeRenderer } from "../renderer";
import type { SlotContribution } from "./types";

export interface SlotContentProps {
  contributions: readonly SlotContribution[] | undefined;
  onCommand: ((command: CmdInvokeParams) => void) | undefined;
  emptyTitle: string;
  emptyHint: string;
  fill?: boolean;
}

const EMPTY_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--omora-space-xs)",
  maxWidth: "36ch",
  color: "var(--omora-color-fg-muted)",
};

const EMPTY_TITLE_STYLE: CSSProperties = {
  margin: 0,
  color: "var(--omora-color-fg)",
  fontSize: "0.875rem",
  fontWeight: 500,
};

const EMPTY_HINT_STYLE: CSSProperties = {
  margin: 0,
  color: "var(--omora-color-fg-faint)",
  fontSize: "0.8125rem",
};

export function SlotContent({
  contributions,
  onCommand,
  emptyTitle,
  emptyHint,
  fill = false,
}: SlotContentProps): ReactElement {
  if (contributions === undefined || contributions.length === 0) {
    const emptyStyle: CSSProperties = fill
      ? { ...EMPTY_STYLE, alignItems: "center", margin: "auto", textAlign: "center" }
      : EMPTY_STYLE;
    return (
      <div data-slot-empty="true" style={emptyStyle}>
        <p style={EMPTY_TITLE_STYLE}>{emptyTitle}</p>
        <p style={EMPTY_HINT_STYLE}>{emptyHint}</p>
      </div>
    );
  }
  return (
    <>
      {contributions.map((contribution, index) => (
        <NodeRenderer
          key={index}
          nodes={contribution.nodes}
          scope={contribution.scope ?? {}}
          onCommand={onCommand}
        />
      ))}
    </>
  );
}

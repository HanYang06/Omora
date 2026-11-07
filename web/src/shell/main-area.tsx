import type { CSSProperties, ReactElement } from "react";

import type { CmdInvokeParams } from "../contract";
import { SlotContent } from "./slot-content";
import type { SlotContribution } from "./types";

export interface MainAreaProps {
  contributions: readonly SlotContribution[] | undefined;
  onCommand: ((command: CmdInvokeParams) => void) | undefined;
  emptyTitle: string;
  emptyHint: string;
}

const MAIN_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  minWidth: 0,
  minHeight: 0,
  overflowY: "auto",
  padding: "var(--omora-space-xl)",
  background: "var(--omora-color-bg)",
};

const COLUMN_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--omora-space-xl)",
  width: "100%",
  maxWidth: "68rem",
  margin: "0 auto",
};

export function MainArea({
  contributions,
  onCommand,
  emptyTitle,
  emptyHint,
}: MainAreaProps): ReactElement {
  return (
    <main data-slot="main" style={MAIN_STYLE}>
      <div style={COLUMN_STYLE}>
        <SlotContent
          contributions={contributions}
          onCommand={onCommand}
          emptyTitle={emptyTitle}
          emptyHint={emptyHint}
          fill
        />
      </div>
    </main>
  );
}

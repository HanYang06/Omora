import type { CSSProperties, ReactElement } from "react";

import type { C3Node, CmdInvokeParams } from "../contract";
import { NodeRenderer } from "../renderer";
import type { BindingScope } from "../renderer/binding";

export const SLOT_NAMES = ["sidebar", "main"] as const;

export type SlotName = (typeof SLOT_NAMES)[number];

export interface SlotContribution {
  nodes: readonly C3Node[];
  scope?: BindingScope;
}

export interface ShellProps {
  contributions: Partial<Record<SlotName, readonly SlotContribution[]>>;
  onCommand?: ((command: CmdInvokeParams) => void) | undefined;
}

const SHELL_STYLE: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(12rem, 16rem) minmax(0, 1fr)",
  height: "100vh",
  boxSizing: "border-box",
};

const SIDEBAR_STYLE: CSSProperties = {
  minHeight: 0,
  overflowY: "auto",
  padding: "var(--omora-space-md, 16px)",
  borderRight: "1px solid currentColor",
};

const MAIN_STYLE: CSSProperties = {
  minHeight: 0,
  overflowY: "auto",
  padding: "var(--omora-space-lg, 24px)",
};

export function Shell({ contributions, onCommand }: ShellProps): ReactElement {
  return (
    <div data-shell="omora" style={SHELL_STYLE}>
      <aside data-slot="sidebar" style={SIDEBAR_STYLE}>
        <SlotContent contributions={contributions.sidebar} onCommand={onCommand} />
      </aside>
      <main data-slot="main" style={MAIN_STYLE}>
        <SlotContent contributions={contributions.main} onCommand={onCommand} />
      </main>
    </div>
  );
}

interface SlotContentProps {
  contributions: readonly SlotContribution[] | undefined;
  onCommand: ((command: CmdInvokeParams) => void) | undefined;
}

function SlotContent({ contributions, onCommand }: SlotContentProps): ReactElement | null {
  if (contributions === undefined) {
    return null;
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

import type { CSSProperties, ReactElement } from "react";

import type { CmdInvokeParams } from "../contract";
import { SlotContent } from "./slot-content";
import { StatusBar } from "./status-bar";
import type { ConnectionStatus, SlotContribution } from "./types";

export interface SidebarProps {
  contributions: readonly SlotContribution[] | undefined;
  onCommand: ((command: CmdInvokeParams) => void) | undefined;
  revision: number;
  status: ConnectionStatus;
}

const SIDEBAR_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--omora-space-lg)",
  minHeight: 0,
  padding: "var(--omora-space-xl) var(--omora-space-lg)",
  background: "var(--omora-color-surface-muted)",
  borderRight: "1px solid var(--omora-color-border)",
};

const BRAND_STYLE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--omora-space-sm)",
  paddingBottom: "var(--omora-space-md)",
};

const MARK_STYLE: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: "18px",
  height: "18px",
  borderRadius: "var(--omora-radius-sm)",
  background: "var(--omora-color-primary)",
};

const MARK_DOT_STYLE: CSSProperties = {
  width: "5px",
  height: "5px",
  borderRadius: "var(--omora-radius-full)",
  background: "var(--omora-color-on-primary)",
};

const WORDMARK_STYLE: CSSProperties = {
  fontSize: "0.9375rem",
  fontWeight: 600,
  letterSpacing: "-0.01em",
};

const SLOT_STYLE: CSSProperties = {
  display: "flex",
  flex: 1,
  flexDirection: "column",
  gap: "var(--omora-space-xl)",
  minHeight: 0,
  overflowY: "auto",
};

export function Sidebar({
  contributions,
  onCommand,
  revision,
  status,
}: SidebarProps): ReactElement {
  return (
    <aside data-slot="sidebar" style={SIDEBAR_STYLE}>
      <header style={BRAND_STYLE}>
        <span aria-hidden="true" style={MARK_STYLE}>
          <span style={MARK_DOT_STYLE} />
        </span>
        <span style={WORDMARK_STYLE}>Omora</span>
      </header>
      <div style={SLOT_STYLE}>
        <SlotContent
          contributions={contributions}
          onCommand={onCommand}
          emptyTitle="侧边栏还没有内容"
          emptyHint="插件注册的入口会显示在这里。"
        />
      </div>
      <StatusBar revision={revision} status={status} />
    </aside>
  );
}

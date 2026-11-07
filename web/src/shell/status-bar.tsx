import type { CSSProperties, ReactElement } from "react";

import type { ConnectionStatus } from "./types";

export interface StatusBarProps {
  revision: number;
  status: ConnectionStatus;
}

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connecting: "连接中",
  online: "已连接",
  reconnecting: "未连接内核 · 重试中",
  closed: "未连接内核",
};

const STATUS_COLOR: Record<ConnectionStatus, string> = {
  connecting: "var(--omora-color-warning)",
  online: "var(--omora-color-primary)",
  reconnecting: "var(--omora-color-warning)",
  closed: "var(--omora-color-fg-faint)",
};

const BAR_STYLE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "var(--omora-space-sm)",
  paddingTop: "var(--omora-space-md)",
  borderTop: "1px solid var(--omora-color-border)",
  color: "var(--omora-color-fg-muted)",
  fontFamily: "var(--omora-font-mono)",
  fontSize: "0.6875rem",
};

const STATUS_STYLE: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "6px",
};

const DOT_STYLE: CSSProperties = {
  width: "6px",
  height: "6px",
  borderRadius: "var(--omora-radius-full)",
  flexShrink: 0,
};

export function StatusBar({ revision, status }: StatusBarProps): ReactElement {
  return (
    <footer data-status-bar="true" data-status={status} data-revision={revision} style={BAR_STYLE}>
      <span style={STATUS_STYLE}>
        <span
          aria-hidden="true"
          data-status-dot="true"
          style={{ ...DOT_STYLE, background: STATUS_COLOR[status] }}
        />
        {STATUS_LABEL[status]}
      </span>
      <span>rev {revision}</span>
    </footer>
  );
}

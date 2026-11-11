import type { ReactNode } from "react";
import type { ConnectionStatus } from "../core/connection";
import { IconGlyph } from "./icons";
import { renderTree } from "../render/renderer";
import type { EventHandler, MediaResolver, PageEntry, Snapshot } from "../core/types";

const STATUS_TEXT: Record<ConnectionStatus, string> = {
  idle: "未连接",
  connecting: "连接中…",
  open: "已连接",
  closed: "连接已断开",
  failed: "连接失败",
};

/** 页面没给 icon 时的缺省图标。 */
const DEFAULT_ICON = "dot";

export interface ShellProps {
  snapshot: Snapshot | null;
  status: ConnectionStatus;
  endpoint: string;
  onNavigate: (page: string) => void;
  onEvent: EventHandler;
  loadMedia: MediaResolver;
}

export interface RailButtonProps {
  entry: PageEntry;
  active: boolean;
  onNavigate: (page: string) => void;
}

/** 图标栏里的一个页面按钮：一个图标，label 只进 aria-label / title。 */
export function RailButton({ entry, active, onNavigate }: RailButtonProps): ReactNode {
  const icon = entry.icon !== undefined && entry.icon.length > 0 ? entry.icon : DEFAULT_ICON;

  return (
    <button
      type="button"
      className="omora-shell-item"
      aria-label={entry.label}
      aria-current={active ? "page" : undefined}
      title={entry.label}
      data-page={entry.name}
      data-icon={icon}
      onClick={() => onNavigate(entry.name)}
    >
      <IconGlyph name={icon} path={entry.glyph} />
    </button>
  );
}

/**
 * 默认母页面：左边 56px 图标栏，右边主区。
 * 索引栏由页面用 Split 排；这里不猜页面内容，只铺满。
 */
export function Shell({
  snapshot,
  status,
  endpoint,
  onNavigate,
  onEvent,
  loadMedia,
}: ShellProps): ReactNode {
  const pages = snapshot?.pages ?? [];
  const current = snapshot?.page ?? "";

  return (
    <div className="omora-app" data-connection={status}>
      <aside className="omora-shell-rail">
        <nav className="omora-shell-nav" aria-label="页面">
          {pages.map((entry) => (
            <RailButton
              key={entry.name}
              entry={entry}
              active={entry.name === current}
              onNavigate={onNavigate}
            />
          ))}
        </nav>
        <div className="omora-shell-foot">
          <div
            className="omora-conn"
            data-status={status}
            title={endpoint}
            role="status"
            aria-label={STATUS_TEXT[status]}
          >
            <span className="omora-conn-dot" aria-hidden="true" />
            <span className="omora-conn-label">{STATUS_TEXT[status]}</span>
          </div>
        </div>
      </aside>
      <main className="omora-page">
        {snapshot === null ? null : (
          <div className="omora-page-inner">
            {renderTree([snapshot.content], onEvent, loadMedia)}
          </div>
        )}
      </main>
    </div>
  );
}

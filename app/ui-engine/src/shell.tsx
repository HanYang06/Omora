import type { ReactNode } from "react";
import type { ConnectionStatus } from "./connection";
import { renderTree } from "./renderer";
import type { EventHandler, MediaResolver, PageEntry, Snapshot } from "./types";

const STATUS_TEXT: Record<ConnectionStatus, string> = {
  idle: "未连接",
  connecting: "连接中…",
  open: "已连接",
  closed: "连接已断开",
  failed: "连接失败",
};

export interface ShellProps {
  snapshot: Snapshot | null;
  status: ConnectionStatus;
  endpoint: string;
  onNavigate: (page: string) => void;
  onEvent: EventHandler;
  loadMedia: MediaResolver;
}

export interface NavItemProps {
  entry: PageEntry;
  active: boolean;
  onNavigate: (page: string) => void;
}

/** 导航里的一行。点击就换页，不走事件。 */
export function NavItem({ entry, active, onNavigate }: NavItemProps): ReactNode {
  return (
    <button
      type="button"
      className="omora-nav-item"
      aria-current={active ? "page" : undefined}
      onClick={() => onNavigate(entry.name)}
    >
      <span>{entry.label}</span>
      {typeof entry.count === "number" ? (
        <span className="omora-nav-count">{entry.count}</span>
      ) : null}
    </button>
  );
}

/** 默认母页面：左边导航，右边一页纸。只认快照，不认业务。 */
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
  const label = pages.find((entry) => entry.name === current)?.label ?? "";

  return (
    <div className="omora-app" data-connection={status}>
      <aside className="omora-sidebar">
        <nav className="omora-nav" aria-label="集合">
          {pages.map((entry) => (
            <NavItem
              key={entry.name}
              entry={entry}
              active={entry.name === current}
              onNavigate={onNavigate}
            />
          ))}
        </nav>
        <div className="omora-sidebar-foot">
          <div className="omora-conn" data-status={status} title={endpoint}>
            <span className="omora-conn-dot" />
            {STATUS_TEXT[status]}
          </div>
        </div>
      </aside>
      <main className="omora-page">
        {snapshot === null ? null : (
          <div className="omora-page-inner">
            <header className="omora-page-head">
              <h1 className="omora-page-title">{label}</h1>
              {snapshot.meta.length > 0 ? (
                <span className="omora-page-count">{snapshot.meta}</span>
              ) : null}
            </header>
            <div className="omora-page-content">
              {renderTree([snapshot.content], onEvent, loadMedia)}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

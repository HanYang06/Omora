import { Children, type ReactNode } from "react";
import { prop, type NodeComponentProps } from "../core/shared";

/** split：先侧栏后主区；两栏各自滚动，一起撑满高度。 */
export function Split({ children }: NodeComponentProps): ReactNode {
  const slots = Children.toArray(children);

  return (
    <div className="omora-split" data-type="split">
      <div className="omora-split-side" data-slot="side">
        {slots[0] ?? null}
      </div>
      <div className="omora-split-main" data-slot="main">
        {slots[1] ?? null}
      </div>
    </div>
  );
}

/** rail：索引栏。标题加一串条目，自己滚动。 */
export function Rail({ node, children }: NodeComponentProps): ReactNode {
  const title = prop(node, "title") ?? "";

  return (
    <aside className="omora-rail" data-type="rail">
      {title.length > 0 ? <h2 className="omora-rail-title">{title}</h2> : null}
      <ul className="omora-rail-list">{children}</ul>
    </aside>
  );
}

/** panel：一块 inset 面，第一个子节点通常是工具条。 */
export function Panel({ children }: NodeComponentProps): ReactNode {
  return (
    <div className="omora-panel" data-type="panel">
      {children}
    </div>
  );
}

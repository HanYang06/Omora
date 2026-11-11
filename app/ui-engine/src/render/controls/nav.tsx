import { Children, useId, useState, type KeyboardEvent, type ReactNode } from "react";
import { textOf, type NodeComponentProps } from "../../core/shared";
import { numeric, headingOf } from "./shared";

/** 局部状态与反馈：标签页、折叠面板、进度条。都只在本组件内记状态。 */

/**
 * tabs：标签页。子节点是每一页的内容，子节点的 label（缺省 title / text）是标签名。
 * 选中第几页是局部状态，默认第一页，不回 Python。
 */
export function Tabs({ node, children }: NodeComponentProps): ReactNode {
  const panels = Children.toArray(children);
  const items = Array.isArray(node.children) ? node.children : [];
  const [active, setActive] = useState(0);
  const count = panels.length;
  const current = count === 0 ? -1 : Math.min(Math.max(active, 0), count - 1);
  const base = useId();

  const move = (event: KeyboardEvent<HTMLDivElement>): void => {
    const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (delta === 0 || count === 0) {
      return;
    }
    event.preventDefault();
    setActive((position) => (((position + delta) % count) + count) % count);
  };

  return (
    <div className="omora-tabs" data-type="tabs">
      <div className="omora-tabs-bar" role="tablist" onKeyDown={move}>
        {panels.map((_, position) => (
          <button
            key={String(position)}
            type="button"
            role="tab"
            id={base + "-tab-" + String(position)}
            aria-controls={base + "-panel-" + String(position)}
            aria-selected={position === current}
            className={position === current ? "omora-tab is-active" : "omora-tab"}
            onClick={() => {
              setActive(position);
            }}
          >
            {headingOf(items[position])}
          </button>
        ))}
      </div>
      {panels.map((panel, position) => (
        <div
          key={String(position)}
          className="omora-tabs-panel"
          role="tabpanel"
          id={base + "-panel-" + String(position)}
          aria-labelledby={base + "-tab-" + String(position)}
          hidden={position !== current}
        >
          {panel}
        </div>
      ))}
    </div>
  );
}

/**
 * accordion：折叠面板。子节点是每一节，子节点的 label（缺省 title / text）是标题，
 * 子树是展开后的内容。默认全部收起，一次只开一节；展开第几项是局部状态，不回 Python。
 * props.open 给初始展开的那一节（缺省全收起）。
 */
export function Accordion({ node, children }: NodeComponentProps): ReactNode {
  const panels = Children.toArray(children);
  const items = Array.isArray(node.children) ? node.children : [];
  const [open, setOpen] = useState<number | null>(() => {
    const initial = numeric(node, "open");
    return initial === undefined ? null : initial;
  });

  return (
    <div className="omora-accordion" data-type="accordion">
      {panels.map((panel, position) => {
        const expanded = position === open;
        return (
          <section key={String(position)} className="omora-accordion-item" data-open={expanded}>
            <button
              type="button"
              className="omora-accordion-head"
              aria-expanded={expanded}
              onClick={() => {
                setOpen(expanded ? null : position);
              }}
            >
              <span className="omora-accordion-title">{headingOf(items[position])}</span>
              <span className="omora-accordion-mark" aria-hidden="true">
                {expanded ? "−" : "+"}
              </span>
            </button>
            {expanded ? <div className="omora-accordion-body">{panel}</div> : null}
          </section>
        );
      })}
    </div>
  );
}

/** progress：进度条。value / max 决定填充宽度，text 是它下面那行说明（可选）。 */
export function Progress({ node }: NodeComponentProps): ReactNode {
  const max = numeric(node, "max") ?? 100;
  const value = numeric(node, "value") ?? 0;
  const now = Math.min(Math.max(value, 0), max);
  const ratio = max > 0 ? now / max : 0;
  const percent = Math.round(Math.min(Math.max(ratio, 0), 1) * 1000) / 10;
  const caption = textOf(node);

  return (
    <div
      className="omora-progress"
      data-type="progress"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={now}
    >
      <div className="omora-progress-track">
        <div className="omora-progress-fill" style={{ width: percent + "%" }} />
      </div>
      {caption.length > 0 ? <span className="omora-progress-text">{caption}</span> : null}
    </div>
  );
}

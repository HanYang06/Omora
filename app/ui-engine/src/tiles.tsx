import type { ReactNode } from "react";
import { IconGlyph } from "./icons";
import { flag, prop, type NodeComponentProps } from "./shared";

/** tile：捕捉块。只有图标 + 标题。 */
export function Tile({ node, onEvent }: NodeComponentProps): ReactNode {
  const icon = prop(node, "icon") ?? "";
  const title = prop(node, "title") ?? "";
  const handler = prop(node, "on_click");
  const clickable = handler !== undefined && handler.length > 0;

  return (
    <button
      type="button"
      className="omora-tile"
      data-type="tile"
      data-handler={clickable ? handler : undefined}
      disabled={!clickable}
      onClick={() => {
        if (clickable) {
          onEvent?.(handler, {});
        }
      }}
    >
      <span className="omora-tile-icon" aria-hidden="true">
        <IconGlyph name={icon} />
      </span>
      <span className="omora-tile-body">
        <span className="omora-tile-title">{title}</span>
      </span>
    </button>
  );
}

/** chip：工具条上的小药丸；active 只决定样子。 */
export function Chip({ node, onEvent }: NodeComponentProps): ReactNode {
  const text = prop(node, "text") ?? "";
  const handler = prop(node, "on_click");
  const active = flag(node, "active");
  const clickable = handler !== undefined && handler.length > 0;

  return (
    <button
      type="button"
      className={active ? "omora-chip is-active" : "omora-chip"}
      data-type="chip"
      data-active={active ? "true" : "false"}
      data-handler={clickable ? handler : undefined}
      aria-pressed={active}
      disabled={!clickable}
      onClick={() => {
        if (clickable) {
          onEvent?.(handler, {});
        }
      }}
    >
      {text}
    </button>
  );
}

import type { ComponentType, ReactNode } from "react";
import { AudioCapture } from "./audio-capture";
import { Card } from "./cards";
import { Audio, Recorder } from "./capture";
import { Icon } from "./icons";
import { Panel, Rail, Split } from "./layout";
import { Result, Search, Suggestion } from "./search";
import { prop, textOf, type NodeComponentProps } from "./shared";
import { Chip, Tile } from "./tiles";
import { VideoCapture } from "./video-capture";
import { VideoPlayer } from "./video-player";

/** column：纵向堆叠。 */
export function Column({ children }: NodeComponentProps): ReactNode {
  return (
    <div className="omora-column" data-type="column">
      {children}
    </div>
  );
}

/** row：横向排列。 */
export function Row({ children }: NodeComponentProps): ReactNode {
  return (
    <div className="omora-row" data-type="row">
      {children}
    </div>
  );
}

/** text：kind 只映射样式类（title / muted / 默认）。 */
export function Text({ node }: NodeComponentProps): ReactNode {
  const kind = prop(node, "kind");
  const className =
    kind === "title"
      ? "omora-text omora-text--title"
      : kind === "muted"
        ? "omora-text omora-text--muted"
        : "omora-text";
  return (
    <span className={className} data-type="text" data-kind={kind ?? "body"}>
      {textOf(node)}
    </span>
  );
}

/** button：props.on_click 是 handler id；variant 只决定样子。 */
export function Button({ node, onEvent }: NodeComponentProps): ReactNode {
  const handler = prop(node, "on_click");
  const variant = prop(node, "variant");
  const className =
    variant === "ghost" ? "omora-button omora-button--ghost" : "omora-button";
  const clickable = handler !== undefined && handler.length > 0;

  return (
    <button
      type="button"
      className={className}
      data-type="button"
      data-handler={clickable ? handler : undefined}
      disabled={!clickable}
      onClick={() => {
        if (handler !== undefined && handler.length > 0) {
          onEvent?.(handler, {});
        }
      }}
    >
      {textOf(node)}
    </button>
  );
}

/** input：一行捕捉。回车把值交回去，然后清空自己。 */
export function Input({ node, onEvent }: NodeComponentProps): ReactNode {
  const handler = prop(node, "on_submit");
  const placeholder = prop(node, "placeholder") ?? "";

  return (
    <div className="omora-capture" data-type="input">
      <span className="omora-capture-plus" aria-hidden="true">
        +
      </span>
      <input
        className="omora-capture-input"
        placeholder={placeholder}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || handler === undefined) {
            return;
          }
          const value = event.currentTarget.value.trim();
          if (value.length === 0) {
            return;
          }
          onEvent?.(handler, { value });
          event.currentTarget.value = "";
        }}
      />
      <span className="omora-capture-hint" aria-hidden="true">
        回车
      </span>
    </div>
  );
}

/** list：账本容器。 */
export function List({ children }: NodeComponentProps): ReactNode {
  return (
    <ul className="omora-list" data-type="list">
      {children}
    </ul>
  );
}

/**
 * item：左栏 meta、右边标题，子节点是这一行的动作。
 * 给了 on_click 就整行可点：标题仍是原生按钮（键盘由它负责），
 * 行内动作放在一个不传点击的容器里，避免误触整行。
 */
export function Item({ node, onEvent, children }: NodeComponentProps): ReactNode {
  const title = prop(node, "title") ?? "";
  const handler = prop(node, "on_click");
  const clickable = handler !== undefined && handler.length > 0;

  const fire = (): void => {
    if (clickable) {
      onEvent?.(handler, {});
    }
  };

  return (
    <li
      className="omora-item"
      data-type="item"
      data-handler={clickable ? handler : undefined}
      onClick={clickable ? fire : undefined}
    >
      <span className="omora-item-meta">{prop(node, "meta") ?? ""}</span>
      <span className="omora-item-main">
        {clickable ? (
          <button
            type="button"
            className="omora-item-link"
            data-handler={handler}
            onClick={(event) => {
              event.stopPropagation();
              fire();
            }}
          >
            {title}
          </button>
        ) : (
          <span className="omora-item-title">{title}</span>
        )}
        {clickable ? (
          <span
            className="omora-item-actions"
            onClick={(event) => event.stopPropagation()}
          >
            {children}
          </span>
        ) : (
          children
        )}
      </span>
    </li>
  );
}

/** empty：空状态。没有 hint 就不画第二行。 */
export function Empty({ node }: NodeComponentProps): ReactNode {
  const hint = prop(node, "hint");
  return (
    <div className="omora-empty" data-type="empty">
      <p className="omora-empty-title">{prop(node, "title") ?? ""}</p>
      {hint !== undefined && hint.length > 0 ? (
        <p className="omora-empty-hint">{hint}</p>
      ) : null}
    </div>
  );
}

/** 组件注册表。未知 type 由 renderer 画占位框。 */
export const components: Record<string, ComponentType<NodeComponentProps>> = {
  column: Column,
  row: Row,
  text: Text,
  button: Button,
  input: Input,
  recorder: Recorder,
  audio: Audio,
  audio_capture: AudioCapture,
  video_capture: VideoCapture,
  video: VideoPlayer,
  list: List,
  item: Item,
  empty: Empty,
  search: Search,
  suggestion: Suggestion,
  result: Result,
  split: Split,
  rail: Rail,
  panel: Panel,
  icon: Icon,
  tile: Tile,
  chip: Chip,
  card: Card,
};
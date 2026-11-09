import type { ComponentType, ReactNode } from "react";
import { AudioCapture } from "./audio-capture";
import { Audio, Recorder } from "./capture";
import { Result, Search, Suggestion } from "./search";
import { prop, textOf, type NodeComponentProps } from "./shared";
import { VideoCapture, VideoPlayer } from "./video-capture";

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

/** item：左栏 meta、右边标题，子节点是这一行的动作。 */
export function Item({ node, children }: NodeComponentProps): ReactNode {
  return (
    <li className="omora-item" data-type="item">
      <span className="omora-item-meta">{prop(node, "meta") ?? ""}</span>
      <span className="omora-item-main">
        <span className="omora-item-title">{prop(node, "title") ?? ""}</span>
        {children}
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
};
import { Children, type ReactNode } from "react";
import { prop, type NodeComponentProps } from "../core/shared";

/**
 * card：推荐卡片。整张卡片进 detail；子节点是可选媒体。
 * 没有 on_click 就只是静态卡片。
 */
export function Card({ node, onEvent, children }: NodeComponentProps): ReactNode {
  const title = prop(node, "title") ?? "";
  const text = prop(node, "text") ?? "";
  const meta = prop(node, "meta") ?? "";
  const handler = prop(node, "on_click");
  const clickable = handler !== undefined && handler.length > 0;
  const media = Children.toArray(children);

  const fire = (): void => {
    if (clickable) {
      onEvent?.(handler, {});
    }
  };

  return (
    <article
      className="omora-card"
      data-type="card"
      data-handler={clickable ? handler : undefined}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={clickable ? fire : undefined}
      onKeyDown={
        clickable
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                fire();
              }
            }
          : undefined
      }
    >
      <div className="omora-card-head">
        <h3 className="omora-card-title">{title}</h3>
        {meta.length > 0 ? <span className="omora-card-meta">{meta}</span> : null}
      </div>
      {text.length > 0 ? <p className="omora-card-text">{text}</p> : null}
      {media.length > 0 ? (
        <div
          className="omora-card-media"
          onClick={(event) => {
            event.stopPropagation();
          }}
        >
          {media}
        </div>
      ) : null}
    </article>
  );
}

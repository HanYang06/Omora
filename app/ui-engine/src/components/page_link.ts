/**
 * 导航入口 kind（\`page-link\`）：V1 树与导航共用同一个按钮实现。
 *
 * 按钮形状复用壳层 \`.omora-shell-item\` 样式，另带 \`.omora-page-link\` 作为语义钩子；
 * label / icon 落到可访问性属性与图标，click 一律经 handlerOf + ctx.event 回传
 * handler id——不做导航，那是运行时的事。props.active=true 时标 \`aria-current="page"\`。
 * 没有 handler 时按钮禁用（和 legacy 的「无 handler = 禁用态」一致）。
 */

import type { Node } from "../renderer/types";
import { handlerOf } from "../renderer/events";
import { iconGlyph, paintGlyph } from "./icons";
import type { Kind } from "../renderer/types";

/** 没有图标时用壳层同款默认点。 */
const DEFAULT_ICON = "dot";

function stringProp(node: Node, name: string): string | undefined {
  const value = node.props[name];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

interface PageLinkParts {
  icon: SVGSVGElement;
}

const pageLinkParts = new WeakMap<HTMLElement, PageLinkParts>();

function clickHandler(node: Node): string | undefined {
  const handler = handlerOf(node, "click");
  return handler !== undefined && handler.length > 0 ? handler : undefined;
}

function syncPageLink(el: HTMLElement, node: Node): void {
  const button = el as HTMLButtonElement;
  const handler = clickHandler(node);
  if (handler === undefined) {
    delete button.dataset.handler;
    button.disabled = true;
    button.setAttribute("aria-disabled", "true");
  } else {
    button.dataset.handler = handler;
    button.disabled = false;
    button.removeAttribute("aria-disabled");
  }

  if (node.props.active === true) {
    button.setAttribute("aria-current", "page");
  } else {
    button.removeAttribute("aria-current");
  }

  const label = stringProp(node, "label");
  if (label === undefined) {
    button.removeAttribute("aria-label");
    button.removeAttribute("title");
  } else {
    button.setAttribute("aria-label", label);
    button.title = label;
  }

  const parts = pageLinkParts.get(el);
  if (parts !== undefined) {
    paintGlyph(parts.icon, stringProp(node, "icon") ?? DEFAULT_ICON);
  }
}

export const pageLink: Kind = {
  create(node, ctx) {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "omora-shell-item omora-page-link";
    el.dataset.type = node.type;
    const icon = iconGlyph(stringProp(node, "icon") ?? DEFAULT_ICON);
    el.append(icon);
    pageLinkParts.set(el, { icon });
    const fire = (): void => {
      const handler = el.dataset.handler;
      if (handler !== undefined && handler.length > 0) {
        ctx.event(handler, {});
      }
    };
    el.addEventListener("click", fire);
    ctx.cleanup(() => el.removeEventListener("click", fire));
    syncPageLink(el, node);
    return el;
  },
  update(el, node) {
    syncPageLink(el, node);
  },
  childrenHosts: () => null,
};

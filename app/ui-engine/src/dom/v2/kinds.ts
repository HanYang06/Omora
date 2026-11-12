/**
 * v2 原生 kind（S3-d）：`dendro:window` / `dendro:page` / `dendro:slot` /
 * `dendro:layer` 与 `dendro:page-link`。
 *
 * 容器 kind 只把 Slot 的 `layout.flow` 映射到现有布局 class：
 * - `row` → `.omora-row`
 * - `column` → `.omora-column`
 * - `stack` → `.omora-column` + `data-flow="stack"`
 * - `none` / 没有 layout → 不加布局 class（div 的自然块流）
 *
 * `data-type` 记完整 kind，`data-flow` 记 flow 供样式/测试读取；size / gap /
 * align / scroll 不进 DOM——格式不碰 CSS，其余布局由样式表与后续协调层处理。
 *
 * 这里不复制 v1 kind 的渲染逻辑：v1 词表经 registry.ts 的 `dendro:<type>` 别名
 * 直接复用，只有 v2 结构 kind 与页链接在本文件实现。
 */

import type { LayoutFlow } from "../../core/document";
import type { Node } from "../../core/types";
import { handlerOf } from "../events";
import { iconGlyph, paintGlyph } from "../icons";
import type { Kind, KindRegistry } from "../types";

/** 没有图标时用壳层同款默认点。 */
const DEFAULT_ICON = "dot";

function stringProp(node: Node, name: string): string | undefined {
  const value = node.props[name];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function flowOf(node: Node): LayoutFlow | undefined {
  const flow = node.layout?.flow;
  return flow === "row" || flow === "column" || flow === "stack" || flow === "none"
    ? flow
    : undefined;
}

/** flow → 现有布局 class；none / 缺省返回空串（不加布局 class）。 */
function flowClass(flow: LayoutFlow | undefined): string {
  if (flow === "row") {
    return "omora-row";
  }
  if (flow === "column" || flow === "stack") {
    return "omora-column";
  }
  return "";
}

function syncContainer(el: HTMLElement, node: Node): void {
  const flow = flowOf(node);
  const className = flowClass(flow);
  if (el.className !== className) {
    el.className = className;
  }
  el.dataset.type = node.type;
  if (flow === undefined) {
    delete el.dataset.flow;
  } else {
    el.dataset.flow = flow;
  }
}

/**
 * 结构容器：window / page / slot / layer 的行为完全一致——都是「按 layout.flow
 * 画的 div，children 挂自己」。同一个 Kind 实例注册到四个 kind 名，data-type
 * 从 node.type 读，所以不需要按 kind 分支。
 */
const layoutContainer: Kind = {
  create(node) {
    const el = document.createElement("div");
    syncContainer(el, node);
    return el;
  },
  update(el, node) {
    syncContainer(el, node);
  },
};

/* ------------------------------------------------------------------ */
/* page-link                                                           */
/* ------------------------------------------------------------------ */

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

/**
 * page-link：导航里的一个页面入口。按钮形状复用壳层 `.omora-shell-item` 样式，
 * 另带 `.omora-page-link` 作为语义钩子；label / icon 落到可访问性属性与图标，
 * click 一律经 handlerOf + ctx.event 回传 handler id——不做导航，那是运行时的事。
 * 没有 handler 时按钮禁用（和 v1 的「无 handler = 禁用态」一致）。
 */
const pageLink: Kind = {
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

/** v2 原生 kind 注册表；名字带命名空间，与 v1 词表别名共用一张 v2 注册表。 */
export const v2Kinds: KindRegistry = {
  "dendro:window": layoutContainer,
  "dendro:page": layoutContainer,
  "dendro:slot": layoutContainer,
  "dendro:layer": layoutContainer,
  "dendro:page-link": pageLink,
};

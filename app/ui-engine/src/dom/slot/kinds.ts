/**
 * v2 原生 kind（S3-d）：`dendro:window` / `dendro:page` / `dendro:slot` /
 * `dendro:layer` 与 `dendro:page-link`。
 *
 * 容器 kind 保留 v1 布局 class，同时把 Slot 的 `layout` 描述符（flow /
 * gap / align / scroll / size）落成 DOM 可消费的形式；capacity 只做语义，
 * 不进样式。落点契约由 `syncContainer` 实现，测试逐条钉住：
 *
 * - class 保持 v1 形态（不新增 class，避免改变既有 className 契约）：
 *   `row` → `.omora-row`；`column` / `stack` → `.omora-column`；
 *   `none` / 没有 layout → 不加布局 class（div 的自然块流）。
 * - marker：所有 v2 容器都带 `data-dendro-layout="v2"`，作为样式段钩子与调试标记。
 * - `data-type` 记完整 kind；`data-flow` 记 flow（缺省时删除）。
 * - gap token → `--dendro-gap`（写 CSS 值）+ `data-gap`（写原始 token）：
 *   `none → 0`；`xs/sm/md/lg/xl → var(--s1/--s2/--s3/--s4/--s5)`；
 *   `s1..s7 → var(--sN)`；未登记的 token 原样写入（本身是合法 CSS 长度就生效，
 *   否则该声明被浏览器忽略，间距回落到默认）。
 * - align → `--dendro-align` + `data-align`：start / center / stretch 本身就是
 *   合法的 align-items 值，原样透传。
 * - scroll → `--dendro-overflow` + `data-scroll`：`none → visible`、
 *   `x → auto hidden`、`y → hidden auto`（overflow 简写两值即 x/y，避免
 *   x 顺带打开纵向滚动）。
 * - size.width / size.height（只消费这两个键）→ `--dendro-width` /
 *   `--dendro-height` + `data-size-width` / `data-size-height`（原始值）：
 *   数字 → `<n>px`，`fill` → `100%`，其余字符串原样（如 `12rem` / `auto`）。
 *   size 的其它键（min / max 等）暂不进样式。
 * - update 原地改：字段消失时删掉对应 CSS 变量与 data 属性；变量写在内联样式上，
 *   只命中本元素的 v2 样式段（styles.css 的 `[data-dendro-layout]`）。
 *
 * 这里不复制 v1 kind 的渲染逻辑：v1 词表经 registry.ts 的 `dendro:<type>` 别名
 * 直接复用，只有 v2 结构 kind 与页链接在本文件实现。
 */

import type { LayoutFlow, Scroll } from "../../core/document";
import type { Node } from "../../core/types";
import { handlerOf } from "../events";
import { iconGlyph, paintGlyph } from "../icons";
import type { Kind, KindRegistry } from "../types";

/** 没有图标时用壳层同款默认点。 */
const DEFAULT_ICON = "dot";

/** 所有 v2 容器共享的 marker 值；styles.css 用 [data-dendro-layout] 命中。 */
const LAYOUT_MARKER = "slot";

/**
 * 间距 token → CSS 值的对照表（第一版约定；词表未在 docs 固定）。
 *
 * - 语义档 xs / sm / md / lg / xl 对齐 `--s1..--s5`（4 / 8 / 12 / 16 / 24）；
 * - 直接写刻度名 s1..s7 时映射到同名变量，避免文档里的 "s3" 变成非法值；
 * - 表外 token 原样透传，交给 CSS 判断是不是合法长度。
 */
const GAP_TOKENS: Readonly<Record<string, string>> = {
  none: "0",
  xs: "var(--s1)",
  sm: "var(--s2)",
  md: "var(--s3)",
  lg: "var(--s4)",
  xl: "var(--s5)",
  s1: "var(--s1)",
  s2: "var(--s2)",
  s3: "var(--s3)",
  s4: "var(--s4)",
  s5: "var(--s5)",
  s6: "var(--s6)",
  s7: "var(--s7)",
};

function gapValue(token: string): string {
  return GAP_TOKENS[token] ?? token;
}

function overflowValue(scroll: Scroll): string {
  if (scroll === "x") {
    return "auto hidden";
  }
  if (scroll === "y") {
    return "hidden auto";
  }
  return "visible";
}

function sizeValue(value: string | number): string {
  if (typeof value === "number") {
    return String(value) + "px";
  }
  return value === "fill" ? "100%" : value;
}

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

function setData(el: HTMLElement, key: string, value: string | undefined): void {
  if (value === undefined) {
    delete el.dataset[key];
  } else {
    el.dataset[key] = value;
  }
}

function setStyleVar(el: HTMLElement, name: string, value: string | undefined): void {
  if (value === undefined) {
    el.style.removeProperty(name);
    return;
  }
  if (el.style.getPropertyValue(name) !== value) {
    el.style.setProperty(name, value);
  }
}

function syncContainer(el: HTMLElement, node: Node): void {
  const layout = node.layout;
  const flow = flowOf(node);
  const className = flowClass(flow);
  if (el.className !== className) {
    el.className = className;
  }
  el.dataset.type = node.type;
  el.dataset.dendroLayout = LAYOUT_MARKER;
  setData(el, "flow", flow);

  setData(el, "gap", layout?.gap);
  setStyleVar(el, "--dendro-gap", layout?.gap === undefined ? undefined : gapValue(layout.gap));

  setData(el, "align", layout?.align);
  setStyleVar(el, "--dendro-align", layout?.align);

  setData(el, "scroll", layout?.scroll);
  setStyleVar(
    el,
    "--dendro-overflow",
    layout?.scroll === undefined ? undefined : overflowValue(layout.scroll),
  );

  const width = layout?.size?.width;
  const height = layout?.size?.height;
  setData(el, "sizeWidth", width === undefined ? undefined : String(width));
  setData(el, "sizeHeight", height === undefined ? undefined : String(height));
  setStyleVar(el, "--dendro-width", width === undefined ? undefined : sizeValue(width));
  setStyleVar(el, "--dendro-height", height === undefined ? undefined : sizeValue(height));
}

/**
 * 结构容器：window / page / slot / layer 的行为完全一致——都是「按 layout 画的
 * div，children 挂自己」。同一个 Kind 实例注册到四个 kind 名，data-type 从
 * node.type 读，所以不需要按 kind 分支。
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
export const slotKinds: KindRegistry = {
  "dendro:window": layoutContainer,
  "dendro:page": layoutContainer,
  "dendro:slot": layoutContainer,
  "dendro:layer": layoutContainer,
  "dendro:page-link": pageLink,
};

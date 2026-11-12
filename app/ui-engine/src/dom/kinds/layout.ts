import type { Node } from "../../core/types";
import { handlerOf } from "../events";
import type { Kind, KindRegistry } from "../types";

/**
 * 布局组 kind：column / row / list / item / split / rail / panel / slot（empty / card 在 cards.ts）。
 *
 * 只保留现有 class / data-type / data-handler 结构，样式表不动；update 一律原地改，
 * 不重建整棵元素。childrenHosts 返回的挂载点必须是稳定 wrapper：renderer 在 create/update
 * 后都会重算 hosts，但只会引用 wrapper 元素本身，换掉它子节点就丢。
 * 本组没有 document 级监听、定时器或媒体，卸载只需 renderer 移除元素本身。
 */

/** 与 core/shared.ts 同语义，但 dom/ 不依赖 React 类型。 */
function prop(node: Node, name: string): string | undefined {
  const value = node.props[name];
  return typeof value === "string" ? value : undefined;
}

function flag(node: Node, name: string): boolean {
  return node.props[name] === true;
}

/** v1.5 事件入口：events.click 优先，回退 props.on_click；空串不算。 */
function clickHandler(node: Node): string | undefined {
  const handler = handlerOf(node, "click");
  return handler !== undefined && handler.length > 0 ? handler : undefined;
}

function setHandler(el: HTMLElement, handler: string | undefined): void {
  if (handler === undefined) {
    delete el.dataset.handler;
    return;
  }
  el.dataset.handler = handler;
}

function container(tag: string, className: string, type: string): HTMLElement {
  const el = document.createElement(tag);
  el.className = className;
  el.dataset.type = type;
  return el;
}

/** column：纵向堆叠。 */
const column: Kind = {
  create: () => container("div", "omora-column", "column"),
};

/** row：横向排列；spread 时两头分开。 */
function renderRow(el: HTMLElement, node: Node): void {
  const className = flag(node, "spread") ? "omora-row omora-row--spread" : "omora-row";
  if (el.className !== className) {
    el.className = className;
  }
}

const row: Kind = {
  create(node) {
    const el = container("div", "omora-row", "row");
    renderRow(el, node);
    return el;
  },
  update(el, node) {
    renderRow(el, node);
  },
};

/** list：账本容器。 */
const list: Kind = {
  create: () => container("ul", "omora-list", "list"),
};

interface ItemParts {
  meta: HTMLSpanElement;
  main: HTMLSpanElement;
  actions: HTMLSpanElement;
  title: HTMLElement;
}

const itemParts = new WeakMap<HTMLElement, ItemParts>();

function createItemTitle(title: string, handler: string | undefined): HTMLElement {
  if (handler === undefined) {
    const span = document.createElement("span");
    span.className = "omora-item-title";
    span.textContent = title;
    return span;
  }
  const link = document.createElement("button");
  link.type = "button";
  link.className = "omora-item-link";
  link.dataset.handler = handler;
  link.textContent = title;
  return link;
}

function updateItem(el: HTMLElement, node: Node): void {
  const parts = itemParts.get(el);
  if (parts === undefined) {
    return;
  }
  const handler = clickHandler(node);
  setHandler(el, handler);
  parts.meta.textContent = prop(node, "meta") ?? "";
  const title = prop(node, "title") ?? "";
  const current = parts.title;
  const isLink = current.tagName === "BUTTON";
  if (handler !== undefined) {
    if (isLink) {
      current.textContent = title;
      current.dataset.handler = handler;
    } else {
      const next = createItemTitle(title, handler);
      current.replaceWith(next);
      parts.title = next;
    }
  } else if (!isLink) {
    current.textContent = title;
  } else {
    const next = createItemTitle(title, undefined);
    current.replaceWith(next);
    parts.title = next;
  }
}

/**
 * item：左栏 meta、右边标题，子节点是这一行的动作。
 *
 * 可点行整行可点，但动作容器里的点击不冒到整行（等价于 React 版的 stopPropagation）。
 * 动作容器必须永远存在：它是 childrenHosts 的挂载点，update 换掉它就丢动作子节点。
 */
const item: Kind = {
  create(node, ctx) {
    const el = document.createElement("li");
    el.className = "omora-item";
    el.dataset.type = "item";
    const meta = document.createElement("span");
    meta.className = "omora-item-meta";
    const main = document.createElement("span");
    main.className = "omora-item-main";
    const title = document.createElement("span");
    title.className = "omora-item-title";
    const actions = document.createElement("span");
    actions.className = "omora-item-actions";
    main.append(title, actions);
    el.append(meta, main);
    itemParts.set(el, { meta, main, actions, title });
    updateItem(el, node);
    el.addEventListener("click", (event) => {
      const handler = el.dataset.handler;
      if (handler === undefined || handler.length === 0) {
        return;
      }
      const parts = itemParts.get(el);
      const target = event.target;
      if (parts !== undefined && target instanceof Element && parts.actions.contains(target)) {
        return;
      }
      ctx.event(handler, {});
    });
    return el;
  },
  update(el, node) {
    updateItem(el, node);
  },
  childrenHosts(el) {
    const parts = itemParts.get(el);
    return parts === undefined ? null : [parts.actions];
  },
};

interface SplitParts {
  side: HTMLDivElement;
  main: HTMLDivElement;
}

const splitParts = new WeakMap<HTMLElement, SplitParts>();

/** split：先侧栏后主区；两个 wrapper 各是一个 children 挂载点，两栏各自滚动。 */
const split: Kind = {
  create() {
    const el = container("div", "omora-split", "split");
    const side = document.createElement("div");
    side.className = "omora-split-side";
    side.dataset.slot = "side";
    const main = document.createElement("div");
    main.className = "omora-split-main";
    main.dataset.slot = "main";
    el.append(side, main);
    splitParts.set(el, { side, main });
    return el;
  },
  childrenHosts(el) {
    const parts = splitParts.get(el);
    return parts === undefined ? null : [parts.side, parts.main];
  },
};

interface RailParts {
  list: HTMLUListElement;
  title: HTMLHeadingElement | null;
}

const railParts = new WeakMap<HTMLElement, RailParts>();

function updateRail(el: HTMLElement, node: Node): void {
  const parts = railParts.get(el);
  if (parts === undefined) {
    return;
  }
  const title = prop(node, "title") ?? "";
  if (title.length === 0) {
    if (parts.title !== null) {
      parts.title.remove();
      parts.title = null;
    }
    return;
  }
  if (parts.title === null) {
    const heading = document.createElement("h2");
    heading.className = "omora-rail-title";
    el.insertBefore(heading, parts.list);
    parts.title = heading;
  }
  if (parts.title.textContent !== title) {
    parts.title.textContent = title;
  }
}

/** rail：索引栏；标题可选，条目挂进 rail-list，自己滚动。 */
const rail: Kind = {
  create(node) {
    const el = container("aside", "omora-rail", "rail");
    const railList = document.createElement("ul");
    railList.className = "omora-rail-list";
    el.append(railList);
    railParts.set(el, { list: railList, title: null });
    updateRail(el, node);
    return el;
  },
  update(el, node) {
    updateRail(el, node);
  },
  childrenHosts(el) {
    const parts = railParts.get(el);
    return parts === undefined ? null : [parts.list];
  },
};

/** panel：内嵌面板，第一块通常是工具条。 */
const panel: Kind = {
  create: () => container("div", "omora-panel", "panel"),
};

/** slot：一个挂接位置；没内容就是空。 */
const slot: Kind = {
  create: () => container("div", "omora-slot", "slot"),
};

/** 布局类 kind。 */
export const layoutKinds: KindRegistry = {
  column,
  row,
  list,
  item,
  split,
  rail,
  panel,
  slot,
};

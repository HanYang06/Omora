import type { Node } from "../core/types";
import { handlerOf } from "../renderer/events";
import type { Kind, KindRegistry } from "../renderer/types";

/**
 * 卡片组 kind：empty / card。
 *
 * 与 layout.ts 同约定：保留现有 class / data-type / data-handler，update 一律原地改；
 * childrenHosts 返回的挂载点必须是跨更新稳定的 wrapper。本组没有 document 级监听、
 * 定时器或媒体，卸载只需 renderer 移除元素本身。
 */

/** 与 core/shared.ts 同语义，但 renderer/ 不依赖 React 类型。 */
function prop(node: Node, name: string): string | undefined {
  const value = node.props[name];
  return typeof value === "string" ? value : undefined;
}

/** legacy 事件入口：events.click 优先，回退 props.on_click；空串不算。 */
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

interface EmptyParts {
  title: HTMLParagraphElement;
  hint: HTMLParagraphElement | null;
}

const emptyParts = new WeakMap<HTMLElement, EmptyParts>();

function updateEmpty(el: HTMLElement, node: Node): void {
  const parts = emptyParts.get(el);
  if (parts === undefined) {
    return;
  }
  const title = prop(node, "title") ?? "";
  if (parts.title.textContent !== title) {
    parts.title.textContent = title;
  }
  const hint = prop(node, "hint");
  if (hint === undefined || hint.length === 0) {
    if (parts.hint !== null) {
      parts.hint.remove();
      parts.hint = null;
    }
    return;
  }
  if (parts.hint === null) {
    const paragraph = document.createElement("p");
    paragraph.className = "omora-empty-hint";
    el.append(paragraph);
    parts.hint = paragraph;
  }
  if (parts.hint.textContent !== hint) {
    parts.hint.textContent = hint;
  }
}

/** empty：空状态；没有 hint 就不画第二行。子节点不参与渲染（与 legacy 一致）。 */
const empty: Kind = {
  create(node) {
    const el = container("div", "omora-empty", "empty");
    const title = document.createElement("p");
    title.className = "omora-empty-title";
    el.append(title);
    emptyParts.set(el, { title, hint: null });
    updateEmpty(el, node);
    return el;
  },
  update(el, node) {
    updateEmpty(el, node);
  },
  childrenHosts() {
    return null;
  },
};

interface CardParts {
  head: HTMLDivElement;
  title: HTMLHeadingElement;
  meta: HTMLSpanElement;
  text: HTMLParagraphElement;
  media: HTMLDivElement | null;
}

const cardParts = new WeakMap<HTMLElement, CardParts>();

function hasChildren(node: Node): boolean {
  return Array.isArray(node.children) && node.children.length > 0;
}

/** 媒体容器只在有子节点时存在；没有媒体就不该有 margin-top 的空面。 */
function ensureCardMedia(el: HTMLElement, parts: CardParts, node: Node): void {
  if (!hasChildren(node)) {
    if (parts.media !== null) {
      parts.media.remove();
      parts.media = null;
    }
    return;
  }
  if (parts.media === null) {
    const media = document.createElement("div");
    media.className = "omora-card-media";
    el.append(media);
    parts.media = media;
  }
}

function updateCard(el: HTMLElement, node: Node): void {
  const parts = cardParts.get(el);
  if (parts === undefined) {
    return;
  }
  const handler = clickHandler(node);
  setHandler(el, handler);
  if (handler === undefined) {
    el.removeAttribute("role");
    el.removeAttribute("tabindex");
  } else {
    el.setAttribute("role", "button");
    el.tabIndex = 0;
  }

  const title = prop(node, "title") ?? "";
  if (parts.title.textContent !== title) {
    parts.title.textContent = title;
  }

  // meta 在标题右边；有才插进去（legacy head 里只有 title + 可选 meta）。
  const meta = prop(node, "meta") ?? "";
  if (meta.length === 0) {
    parts.meta.remove();
  } else {
    if (parts.meta.parentElement !== parts.head) {
      parts.head.append(parts.meta);
    }
    if (parts.meta.textContent !== meta) {
      parts.meta.textContent = meta;
    }
  }

  // 正文在 head 与媒体之间；有才插进去。
  const text = prop(node, "text") ?? "";
  if (text.length === 0) {
    parts.text.remove();
  } else {
    if (parts.text.parentElement !== el) {
      if (parts.media === null) {
        el.append(parts.text);
      } else {
        el.insertBefore(parts.text, parts.media);
      }
    }
    if (parts.text.textContent !== text) {
      parts.text.textContent = text;
    }
  }

  // 先摆好正文再决定媒体容器，保证 head → 正文 → 媒体的顺序。
  ensureCardMedia(el, parts, node);
}

/**
 * card：推荐卡片；整张进 detail，子节点是可选媒体。
 *
 * 媒体容器只在有子节点时存在（避免空 .omora-card-media 的 margin），并且是 childrenHosts
 * 的挂载点。点媒体（含媒体里的播放控件）不触发整卡。
 */
const card: Kind = {
  create(node, ctx) {
    const el = document.createElement("article");
    el.className = "omora-card";
    el.dataset.type = "card";
    const head = document.createElement("div");
    head.className = "omora-card-head";
    const title = document.createElement("h3");
    title.className = "omora-card-title";
    head.append(title);
    const meta = document.createElement("span");
    meta.className = "omora-card-meta";
    const text = document.createElement("p");
    text.className = "omora-card-text";
    el.append(head);
    cardParts.set(el, { head, title, meta, text, media: null });
    updateCard(el, node);
    el.addEventListener("click", (event) => {
      const handler = el.dataset.handler;
      if (handler === undefined || handler.length === 0) {
        return;
      }
      const media = cardParts.get(el)?.media ?? null;
      const target = event.target;
      if (media !== null && target instanceof Element && media.contains(target)) {
        return;
      }
      ctx.event(handler, {});
    });
    el.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }
      const handler = el.dataset.handler;
      if (handler === undefined || handler.length === 0) {
        return;
      }
      event.preventDefault();
      ctx.event(handler, {});
    });
    return el;
  },
  update(el, node) {
    updateCard(el, node);
  },
  childrenHosts(el) {
    const media = cardParts.get(el)?.media ?? null;
    return media === null ? null : [media];
  },
};

/** 卡片类 kind；empty 和 card 共用“文案 + 可选子块”的原地更新约定。 */
export const cardKinds: KindRegistry = {
  empty,
  card,
};

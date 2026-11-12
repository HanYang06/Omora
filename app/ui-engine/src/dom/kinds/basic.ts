import type { Node } from "../../core/types";
import { handlerOf } from "../events";
import type { KindRegistry, RenderContext } from "../types";

const SVG_NS = "http://www.w3.org/2000/svg";

/** props 里的字符串字段；不是字符串就等于没给。 */
function stringProp(node: Node, name: string): string | undefined {
  const value = node.props[name];
  return typeof value === "string" ? value : undefined;
}

/** props 里的布尔开关；只有真正的 true 才算开。 */
function flagProp(node: Node, name: string): boolean {
  return node.props[name] === true;
}

function setAttrs(el: Element, attrs: Record<string, string>): void {
  for (const [name, value] of Object.entries(attrs)) {
    el.setAttribute(name, value);
  }
}

/** 有 handler 就写 data-handler，没有就删掉——和 v1 的 markup 一致。 */
function setHandler(el: HTMLElement, handler: string | undefined): void {
  if (handler === undefined) {
    el.removeAttribute("data-handler");
  } else {
    el.setAttribute("data-handler", handler);
  }
}

/** 没有 handler 的按钮/药丸在 v1 里就是禁用态。 */
function setDisabled(el: HTMLElement, disabled: boolean): void {
  if (disabled) {
    el.setAttribute("disabled", "");
  } else {
    el.removeAttribute("disabled");
  }
}

/* ------------------------------------------------------------------ */
/* text                                                                */
/* ------------------------------------------------------------------ */

function syncText(el: HTMLElement, node: Node): void {
  const kind = stringProp(node, "kind");
  el.className =
    kind === "title"
      ? "omora-text omora-text--title"
      : kind === "muted"
        ? "omora-text omora-text--muted"
        : "omora-text";
  el.dataset.type = "text";
  el.dataset.kind = kind ?? "body";
  el.textContent = stringProp(node, "text") ?? "";
}

/* ------------------------------------------------------------------ */
/* icon / tile 共用的图标词表                                           */
/* ------------------------------------------------------------------ */

interface GlyphPart {
  tag: "path" | "rect" | "circle";
  attrs: Record<string, string>;
}

const pathPart = (d: string): GlyphPart => ({ tag: "path", attrs: { d } });
const rectPart = (attrs: Record<string, string>): GlyphPart => ({ tag: "rect", attrs });
const circlePart = (attrs: Record<string, string>): GlyphPart => ({ tag: "circle", attrs });

/** 引擎自带的图标词表；和 React 版本 shell/icons.tsx 是同一份。 */
const GLYPHS: Record<string, readonly GlyphPart[]> = {
  ideas: [
    pathPart("M10 2.8a5.2 5.2 0 0 0-3.1 9.4v1.5h6.2v-1.5A5.2 5.2 0 0 0 10 2.8Z"),
    pathPart("M8.3 16.4h3.4"),
    pathPart("M8.8 18.2h2.4"),
  ],
  projects: [
    pathPart(
      "M3 6.2a1.4 1.4 0 0 1 1.4-1.4h3l1.7 1.9h6.5A1.4 1.4 0 0 1 17 8.1v6.3a1.4 1.4 0 0 1-1.4 1.4H4.4A1.4 1.4 0 0 1 3 14.4Z",
    ),
    pathPart("M3 8.9h14"),
  ],
  requirements: [
    pathPart("M7.4 4.2H5.2v12.6h9.6V4.2h-2.2"),
    rectPart({ x: "7.4", y: "2.6", width: "5.2", height: "3", rx: "1" }),
    pathPart("M8 9.4h4M8 12.4h4M8 15.4h2.6"),
  ],
  settings: [
    circlePart({ cx: "10", cy: "10", r: "2.6" }),
    pathPart("M10 2.6v2M10 15.4v2M2.6 10h2M15.4 10h2M4.8 4.8l1.4 1.4M13.8 13.8l1.4 1.4"),
    pathPart("M15.2 4.8l-1.4 1.4M6.2 13.8l-1.4 1.4"),
  ],
  search: [circlePart({ cx: "8.9", cy: "8.9", r: "4.6" }), pathPart("m12.3 12.3 3.9 3.9")],
  mic: [
    rectPart({ x: "8", y: "2.8", width: "4", height: "7.4", rx: "2" }),
    pathPart("M5.4 9.2a4.6 4.6 0 0 0 9.2 0"),
    pathPart("M10 13.8v2.4M8 16.2h4"),
  ],
  video: [
    rectPart({ x: "2.8", y: "5.6", width: "10.2", height: "8.8", rx: "2" }),
    pathPart("m13 9 4.2-2.3v6.6L13 11"),
  ],
  text: [pathPart("M3.2 5.4h13.6M3.2 9.1h13.6M3.2 12.8h9.4M3.2 16.5h6")],
  pin: [
    pathPart("M7 2.8h6"),
    pathPart("M8.2 2.8v3.6l-1.9 1.8v1.2h7.4V8.2l-1.9-1.8V2.8"),
    pathPart("M10 9.4v7.8"),
  ],
  archive: [
    rectPart({ x: "3", y: "4.4", width: "14", height: "3.6", rx: "1" }),
    pathPart("M4.2 8v6.2a1.4 1.4 0 0 0 1.4 1.4h8.8a1.4 1.4 0 0 0 1.4-1.4V8"),
    pathPart("M8.2 10.8h3.6"),
  ],
  back: [pathPart("M16 10H4M8.4 5.6 4 10l4.4 4.4")],
  plus: [pathPart("M10 3.6v12.8M3.6 10h12.8")],
  dot: [circlePart({ cx: "10", cy: "10", r: "3.2", fill: "currentColor", stroke: "none" })],
};

/** 不认识的图标名：虚线空位，明确表示"这个名字没有图标"，不猜近似。 */
const MISSING_GLYPH: readonly GlyphPart[] = [
  rectPart({
    x: "3.6",
    y: "3.6",
    width: "12.8",
    height: "12.8",
    rx: "2.4",
    "stroke-dasharray": "2 2.4",
  }),
];

interface GlyphPaint {
  parts: readonly GlyphPart[];
  icon: string;
  known: boolean;
  /** 同一份画法不重画；节点自带 path 时按 path 内容判等。 */
  key: string;
}

function paintOf(name: string, path: string | undefined): GlyphPaint {
  if (path !== undefined && path.length > 0) {
    return { parts: [pathPart(path)], icon: "custom", known: true, key: "path:" + path };
  }
  const glyph = GLYPHS[name];
  if (glyph === undefined) {
    return { parts: MISSING_GLYPH, icon: name, known: false, key: "missing:" + name };
  }
  return { parts: glyph, icon: name, known: true, key: "glyph:" + name };
}

/** 每个 svg 上一次画的是哪一份，用来避免没变也重画。 */
const painted = new WeakMap<Element, string>();

function createIconSvg(name: string, path: string | undefined): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  setAttrs(svg, {
    class: "omora-icon-svg",
    width: "20",
    height: "20",
    viewBox: "0 0 20 20",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "1.5",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
    focusable: "false",
  });
  paintSvg(svg, name, path);
  return svg;
}

/** 在同一个 svg 上换成新的图标；画法没变就什么都不动。 */
function paintSvg(svg: SVGSVGElement, name: string, path: string | undefined): void {
  const paint = paintOf(name, path);
  if (painted.get(svg) === paint.key) {
    return;
  }
  painted.set(svg, paint.key);
  svg.setAttribute("data-icon", paint.icon);
  svg.setAttribute("data-known", paint.known ? "true" : "false");
  svg.replaceChildren();
  for (const part of paint.parts) {
    const child = document.createElementNS(SVG_NS, part.tag);
    setAttrs(child, part.attrs);
    svg.appendChild(child);
  }
}

function paintIconOf(el: HTMLElement, node: Node): void {
  const svg = el.firstElementChild;
  if (svg instanceof SVGSVGElement) {
    paintSvg(svg, stringProp(node, "name") ?? "", stringProp(node, "path"));
  }
}

/* ------------------------------------------------------------------ */
/* tile                                                                */
/* ------------------------------------------------------------------ */

function iconHostOf(el: HTMLElement): HTMLElement {
  const host = el.querySelector<HTMLElement>(".omora-tile-icon");
  if (host === null) {
    throw new Error("tile 结构不完整：找不到 .omora-tile-icon");
  }
  return host;
}

function titleOf(el: HTMLElement): HTMLElement {
  const title = el.querySelector<HTMLElement>(".omora-tile-title");
  if (title === null) {
    throw new Error("tile 结构不完整：找不到 .omora-tile-title");
  }
  return title;
}

function syncTile(el: HTMLElement, node: Node): void {
  const handler = handlerOf(node, "click");
  setHandler(el, handler);
  setDisabled(el, handler === undefined);
  titleOf(el).textContent = stringProp(node, "title") ?? "";
  const icon = stringProp(node, "icon") ?? "";
  const path = stringProp(node, "path");
  const host = iconHostOf(el);
  const svg = host.querySelector<SVGSVGElement>("svg");
  if (svg === null) {
    host.appendChild(createIconSvg(icon, path));
  } else {
    paintSvg(svg, icon, path);
  }
}

/* ------------------------------------------------------------------ */
/* chip                                                                */
/* ------------------------------------------------------------------ */

function syncChip(el: HTMLElement, node: Node): void {
  const active = flagProp(node, "active");
  el.className = active ? "omora-chip is-active" : "omora-chip";
  el.dataset.type = "chip";
  el.dataset.active = active ? "true" : "false";
  el.setAttribute("aria-pressed", active ? "true" : "false");
  const handler = handlerOf(node, "click");
  setHandler(el, handler);
  setDisabled(el, handler === undefined);
  el.textContent = stringProp(node, "text") ?? "";
}

/* ------------------------------------------------------------------ */
/* hotkey                                                              */
/* ------------------------------------------------------------------ */

interface HotkeyState {
  key: string;
  onPress: string | undefined;
  onRelease: string | undefined;
  /** 这个键当前算不算被我们按住了；压着不放只发一次按下。 */
  held: boolean;
  emit: RenderContext["event"];
}

const hotkeys = new WeakMap<HTMLElement, HotkeyState>();

/** 把 ctx.event 包成普通函数：kind 里只存函数引用，不存 ctx 的方法。 */
function emitter(ctx: RenderContext): RenderContext["event"] {
  return (handler, payload) => ctx.event(handler, payload);
}

/** 这个键是不是配置的那个：KeyboardEvent.code 或 event.key 的小写都认。 */
function hotkeyMatches(configured: string, code: string, key: string): boolean {
  const wanted = configured.trim().toLowerCase();
  if (wanted.length === 0) {
    return false;
  }
  return code.toLowerCase() === wanted || key.toLowerCase() === wanted;
}

/** 焦点是不是在可编辑控件里；在这里打字时空格是空格，不是快捷键。 */
function isTypingTarget(target: unknown): boolean {
  if (typeof target !== "object" || target === null) {
    return false;
  }
  const record = target as { tagName?: unknown; isContentEditable?: unknown };
  const tag = typeof record.tagName === "string" ? record.tagName.toUpperCase() : "";
  if (tag === "INPUT" || tag === "TEXTAREA") {
    return true;
  }
  return record.isContentEditable === true;
}

function syncHotkey(state: HotkeyState, node: Node, ctx: RenderContext): void {
  state.key = stringProp(node, "key") ?? "";
  state.onPress = handlerOf(node, "press");
  state.onRelease = handlerOf(node, "release");
  state.emit = emitter(ctx);
}

function hotkeyListeners(state: HotkeyState): {
  onDown: (event: KeyboardEvent) => void;
  onUp: (event: KeyboardEvent) => void;
} {
  const onDown = (event: KeyboardEvent): void => {
    if (!hotkeyMatches(state.key, event.code, event.key) || isTypingTarget(event.target)) {
      return;
    }
    event.preventDefault();
    if (event.repeat) {
      return;
    }
    state.held = true;
    if (state.onPress !== undefined) {
      state.emit(state.onPress, {});
    }
  };
  const onUp = (event: KeyboardEvent): void => {
    if (!hotkeyMatches(state.key, event.code, event.key) || !state.held) {
      return;
    }
    event.preventDefault();
    state.held = false;
    if (state.onRelease !== undefined) {
      state.emit(state.onRelease, {});
    }
  };
  return { onDown, onUp };
}

/* ------------------------------------------------------------------ */
/* 注册表                                                              */
/* ------------------------------------------------------------------ */

export const basicKinds: KindRegistry = {
  text: {
    create(node) {
      const el = document.createElement("span");
      syncText(el, node);
      return el;
    },
    update(el, node) {
      syncText(el, node);
    },
    childrenHost: () => null,
  },
  icon: {
    create(node) {
      const el = document.createElement("span");
      el.className = "omora-icon";
      el.dataset.type = "icon";
      el.appendChild(createIconSvg(stringProp(node, "name") ?? "", stringProp(node, "path")));
      return el;
    },
    update(el, node) {
      if (el.firstElementChild === null) {
        el.appendChild(createIconSvg(stringProp(node, "name") ?? "", stringProp(node, "path")));
        return;
      }
      paintIconOf(el, node);
    },
    childrenHost: () => null,
  },
  tile: {
    create(node, ctx) {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "omora-tile";
      el.dataset.type = "tile";
      const iconHost = document.createElement("span");
      iconHost.className = "omora-tile-icon";
      iconHost.setAttribute("aria-hidden", "true");
      iconHost.appendChild(createIconSvg("", undefined));
      const body = document.createElement("span");
      body.className = "omora-tile-body";
      const title = document.createElement("span");
      title.className = "omora-tile-title";
      body.appendChild(title);
      el.append(iconHost, body);
      // 局部状态就在元素上：handler 从 data-handler 读，update 换 id 不用重挂监听。
      const fire = (): void => {
        const handler = el.dataset.handler;
        if (handler !== undefined && handler.length > 0) {
          ctx.event(handler, {});
        }
      };
      el.addEventListener("click", fire);
      ctx.cleanup(() => el.removeEventListener("click", fire));
      syncTile(el, node);
      return el;
    },
    update(el, node) {
      syncTile(el, node);
    },
    childrenHost: () => null,
  },
  chip: {
    create(node, ctx) {
      const el = document.createElement("button");
      el.type = "button";
      const fire = (): void => {
        const handler = el.dataset.handler;
        if (handler !== undefined && handler.length > 0) {
          ctx.event(handler, {});
        }
      };
      el.addEventListener("click", fire);
      ctx.cleanup(() => el.removeEventListener("click", fire));
      syncChip(el, node);
      return el;
    },
    update(el, node) {
      syncChip(el, node);
    },
    childrenHost: () => null,
  },
  hotkey: {
    create(node, ctx) {
      const el = document.createElement("span");
      el.dataset.type = "hotkey";
      // 它不画东西：只挂键盘监听。hidden 保证不占布局、不撑出 row 的间距。
      el.hidden = true;
      el.setAttribute("aria-hidden", "true");
      const state: HotkeyState = {
        key: "",
        onPress: undefined,
        onRelease: undefined,
        held: false,
        emit: emitter(ctx),
      };
      syncHotkey(state, node, ctx);
      hotkeys.set(el, state);
      const { onDown, onUp } = hotkeyListeners(state);
      document.addEventListener("keydown", onDown);
      document.addEventListener("keyup", onUp);
      ctx.cleanup(() => {
        document.removeEventListener("keydown", onDown);
        document.removeEventListener("keyup", onUp);
        hotkeys.delete(el);
      });
      return el;
    },
    update(el, node, ctx) {
      const state = hotkeys.get(el);
      if (state === undefined) {
        return;
      }
      // handler id 每次更新都会换：监听留着，从 state 取最新的一份。
      syncHotkey(state, node, ctx);
    },
    childrenHost: () => null,
  },
};

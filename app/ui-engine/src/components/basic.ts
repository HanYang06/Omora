import type { Node } from "../renderer/types";
import { handlerOf } from "../renderer/events";
import { iconGlyph, paintGlyph } from "./icons";
import type { KindRegistry, RenderContext } from "../renderer/types";

/** props 里的字符串字段；不是字符串就等于没给。 */
function stringProp(node: Node, name: string): string | undefined {
  const value = node.props[name];
  return typeof value === "string" ? value : undefined;
}

/** props 里的布尔开关；只有真正的 true 才算开。 */
function flagProp(node: Node, name: string): boolean {
  return node.props[name] === true;
}

/** 有 handler 就写 data-handler，没有就删掉——和 legacy markup 一致。 */
function setHandler(el: HTMLElement, handler: string | undefined): void {
  if (handler === undefined) {
    el.removeAttribute("data-handler");
  } else {
    el.setAttribute("data-handler", handler);
  }
}

/** 没有 handler 的按钮/药丸在 legacy 里就是禁用态。 */
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
/* icon                                                                */
/* ------------------------------------------------------------------ */

/** 元素里的 svg 换成节点当前的图标；画法没变就什么都不动。 */
function paintIconOf(el: HTMLElement, node: Node): void {
  const svg = el.firstElementChild;
  if (svg instanceof SVGSVGElement) {
    paintGlyph(svg, stringProp(node, "name") ?? "", stringProp(node, "path"));
  }
}

/* ------------------------------------------------------------------ */
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
    host.appendChild(iconGlyph(icon, path));
  } else {
    paintGlyph(svg, icon, path);
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
    childrenHosts: () => null,
  },
  icon: {
    create(node) {
      const el = document.createElement("span");
      el.className = "omora-icon";
      el.dataset.type = "icon";
      el.appendChild(iconGlyph(stringProp(node, "name") ?? "", stringProp(node, "path")));
      return el;
    },
    update(el, node) {
      if (el.firstElementChild === null) {
        el.appendChild(iconGlyph(stringProp(node, "name") ?? "", stringProp(node, "path")));
        return;
      }
      paintIconOf(el, node);
    },
    childrenHosts: () => null,
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
      iconHost.appendChild(iconGlyph("", undefined));
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
    childrenHosts: () => null,
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
    childrenHosts: () => null,
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
    childrenHosts: () => null,
  },
};

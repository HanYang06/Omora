import type { Node } from "../../core/types";
import { highlightParts, keyAction } from "../../search/searchText";
import { handlerOf } from "../events";
import { iconGlyph } from "../icons";
import type { KindRegistry, RenderContext } from "../types";

/** 打字之后等这么久再问后端；再敲一下就重新计时（与 React 版一致）。 */
export const SEARCH_DEBOUNCE_MS = 200;

function prop(node: Node, name: string): string | undefined {
  const value = node.props[name];
  return typeof value === "string" ? value : undefined;
}

function textOf(node: Node): string {
  const value = node.props.text;
  return typeof value === "string" ? value : "";
}

/** props 里的数字。Python 的 int / float 到这儿是 number；也收数字字符串。 */
function numeric(node: Node, name: string): number | undefined {
  const value = node.props[name];
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

/** 条目的头：props.label 优先，其次 title，最后是文字本身。 */
function headingOf(item: Node | undefined): string {
  if (item === undefined) {
    return "";
  }
  const label = prop(item, "label");
  if (label !== undefined && label.length > 0) {
    return label;
  }
  const title = prop(item, "title");
  if (title !== undefined && title.length > 0) {
    return title;
  }
  return textOf(item);
}

function childNodes(node: Node): Node[] {
  return Array.isArray(node.children) ? node.children : [];
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  el.className = className;
  return el;
}

let uid = 0;

function nextId(prefix: string): string {
  uid += 1;
  return "omora-" + prefix + "-" + String(uid);
}

function markedFragment(text: string, query: string | undefined): DocumentFragment {
  const fragment = document.createDocumentFragment();
  for (const segment of highlightParts(text, query)) {
    const el = document.createElement(segment.hit ? "mark" : "span");
    el.textContent = segment.text;
    fragment.append(el);
  }
  return fragment;
}

const markedKeys = new WeakMap<HTMLElement, string>();

/** 命中词标成 <mark>；内容没变就不动 DOM。 */
function setMarked(el: HTMLElement, text: string, query: string | undefined): void {
  const key = (query ?? "") + "\u0000" + text;
  if (markedKeys.get(el) === key) {
    return;
  }
  markedKeys.set(el, key);
  el.replaceChildren(markedFragment(text, query));
}

// —— search ——

interface SearchState {
  ctx: RenderContext;
  root: HTMLDivElement;
  input: HTMLInputElement;
  submit: HTMLButtonElement;
  list: HTMLDivElement;
  /** 每条建议一个稳定的选项 wrapper；childrenHosts 按子节点下标返回。 */
  options: HTMLDivElement[];
  nodes: Node[];
  text: string;
  /** 已经交给 Python 的值；快照带回同值时不覆盖用户正在敲的字。 */
  lastSent: string;
  queryHandler: string | undefined;
  submitHandler: string | undefined;
  active: number;
  dismissed: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  destroyed: boolean;
  onInput: () => void;
  onKeyDown: (event: KeyboardEvent) => void;
  onSubmit: () => void;
}

const searchStates = new WeakMap<HTMLElement, SearchState>();

function stopTimer(state: SearchState): void {
  if (state.timer !== null) {
    clearTimeout(state.timer);
    state.timer = null;
  }
}

function searchOpen(state: SearchState): boolean {
  return !state.dismissed && state.nodes.length > 0;
}

/** 按当前节点数与 active 重算下拉的显隐、aria 与高亮。 */
function syncSearchChrome(state: SearchState): void {
  if (state.nodes.length === 0) {
    state.active = -1;
  } else if (state.active >= state.nodes.length) {
    state.active = state.nodes.length - 1;
  }
  const open = searchOpen(state);
  state.list.hidden = !open;
  state.root.dataset.open = open ? "true" : "false";
  state.input.setAttribute("aria-expanded", open ? "true" : "false");
  state.options.forEach((option, index) => {
    option.classList.toggle("omora-search-option--active", index === state.active);
  });
}

function ensureSearchOptions(state: SearchState, count: number): void {
  while (state.options.length < count) {
    const option = document.createElement("div");
    option.className = "omora-search-option";
    option.setAttribute("role", "presentation");
    state.options.push(option);
  }
  for (const [index, option] of state.options.entries()) {
    if (index < count) {
      const current = state.list.children[index] ?? null;
      if (current !== option) {
        state.list.insertBefore(option, current);
      }
    } else if (option.parentElement !== null) {
      option.remove();
    }
  }
}

function syncSearch(state: SearchState, node: Node): void {
  state.nodes = childNodes(node);
  state.queryHandler = handlerOf(node, "query");
  state.submitHandler = handlerOf(node, "submit");
  state.submit.disabled = state.submitHandler === undefined;
  const placeholder = prop(node, "placeholder") ?? "";
  if (state.input.placeholder !== placeholder) {
    state.input.placeholder = placeholder;
  }
  const value = prop(node, "value") ?? "";
  if (value !== state.lastSent) {
    state.lastSent = value;
    state.text = value;
    if (state.input.value !== value) {
      state.input.value = value;
    }
  }
  ensureSearchOptions(state, state.nodes.length);
  syncSearchChrome(state);
}

function askSearch(state: SearchState): void {
  stopTimer(state);
  if (state.queryHandler === undefined) {
    return;
  }
  const next = state.text;
  state.timer = setTimeout(() => {
    state.timer = null;
    if (state.destroyed) {
      return;
    }
    const handler = state.queryHandler;
    if (handler === undefined) {
      return;
    }
    state.lastSent = next;
    state.ctx.event(handler, { value: next });
  }, SEARCH_DEBOUNCE_MS);
}

function submitSearch(state: SearchState, raw: string): void {
  const trimmed = raw.trim();
  const handler = state.submitHandler;
  if (trimmed.length === 0 || handler === undefined) {
    return;
  }
  stopTimer(state);
  state.lastSent = trimmed;
  state.text = trimmed;
  state.input.value = trimmed;
  state.dismissed = true;
  state.active = -1;
  syncSearchChrome(state);
  state.ctx.event(handler, { value: trimmed });
}

function pickSearch(state: SearchState, index: number): void {
  const suggestion = state.nodes[index];
  if (suggestion === undefined) {
    return;
  }
  const handler = handlerOf(suggestion, "pick");
  const value = prop(suggestion, "value");
  if (handler === undefined || value === undefined) {
    return;
  }
  stopTimer(state);
  state.lastSent = value;
  state.text = value;
  state.input.value = value;
  state.dismissed = true;
  state.active = -1;
  syncSearchChrome(state);
  state.ctx.event(handler, { value });
}

function onSearchInput(state: SearchState): void {
  state.text = state.input.value;
  state.dismissed = false;
  state.active = -1;
  syncSearchChrome(state);
  askSearch(state);
}

function onSearchKeyDown(state: SearchState, event: KeyboardEvent): void {
  const action = keyAction(event.key, {
    open: searchOpen(state),
    active: state.active,
    count: state.nodes.length,
    text: state.text,
  });
  if (action.kind === "none") {
    return;
  }
  event.preventDefault();
  if (action.kind === "move") {
    state.active = action.active ?? -1;
    syncSearchChrome(state);
  } else if (action.kind === "close") {
    state.dismissed = true;
    state.active = -1;
    syncSearchChrome(state);
  } else if (action.kind === "pick") {
    pickSearch(state, action.active ?? -1);
  } else {
    submitSearch(state, state.text);
  }
}

function createSearch(node: Node, ctx: RenderContext): HTMLElement {
  const root = element("div", "omora-search");
  root.dataset.type = "search";
  root.dataset.open = "false";

  const row = element("div", "omora-search-row");
  const icon = element("span", "omora-search-icon");
  icon.setAttribute("aria-hidden", "true");
  icon.append(iconGlyph("search"));

  const input = document.createElement("input");
  input.className = "omora-search-input";
  input.type = "text";
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-expanded", "false");
  input.dataset.type = "search-input";
  input.placeholder = prop(node, "placeholder") ?? "";
  input.value = prop(node, "value") ?? "";

  const submit = document.createElement("button");
  submit.type = "button";
  submit.className = "omora-search-submit";
  submit.dataset.type = "search-submit";
  submit.textContent = "搜索";

  const list = element("div", "omora-search-list");
  list.setAttribute("role", "listbox");
  list.dataset.type = "search-list";
  list.hidden = true;

  row.append(icon, input, submit);
  root.append(row, list);

  const state: SearchState = {
    ctx,
    root,
    input,
    submit,
    list,
    options: [],
    nodes: [],
    text: input.value,
    lastSent: input.value,
    queryHandler: handlerOf(node, "query"),
    submitHandler: handlerOf(node, "submit"),
    active: -1,
    dismissed: false,
    timer: null,
    destroyed: false,
    onInput: () => undefined,
    onKeyDown: () => undefined,
    onSubmit: () => undefined,
  };
  searchStates.set(root, state);
  state.onInput = () => onSearchInput(state);
  state.onKeyDown = (event) => onSearchKeyDown(state, event);
  state.onSubmit = () => submitSearch(state, state.text);
  input.addEventListener("input", state.onInput);
  input.addEventListener("keydown", state.onKeyDown);
  submit.addEventListener("click", state.onSubmit);
  ctx.cleanup(() => {
    state.destroyed = true;
    stopTimer(state);
    input.removeEventListener("input", state.onInput);
    input.removeEventListener("keydown", state.onKeyDown);
    submit.removeEventListener("click", state.onSubmit);
  });
  syncSearch(state, node);
  return root;
}

function destroySearch(el: HTMLElement): void {
  const state = searchStates.get(el);
  if (state === undefined) {
    return;
  }
  state.destroyed = true;
  stopTimer(state);
  state.input.removeEventListener("input", state.onInput);
  state.input.removeEventListener("keydown", state.onKeyDown);
  state.submit.removeEventListener("click", state.onSubmit);
}

// —— suggestion ——

interface SuggestionState {
  ctx: RenderContext;
  button: HTMLButtonElement;
  title: HTMLSpanElement;
  meta: HTMLSpanElement | null;
  handler: string | undefined;
  value: string;
  onClick: () => void;
}

const suggestionStates = new WeakMap<HTMLElement, SuggestionState>();

function syncSuggestion(state: SuggestionState, node: Node): void {
  state.handler = handlerOf(node, "pick");
  state.value = prop(node, "value") ?? "";
  if (state.handler === undefined) {
    state.button.removeAttribute("data-handler");
  } else {
    state.button.dataset.handler = state.handler;
  }
  setMarked(state.title, prop(node, "title") ?? "", prop(node, "highlight"));
  const meta = prop(node, "meta");
  if (meta === undefined || meta.length === 0) {
    state.meta?.remove();
    state.meta = null;
    return;
  }
  if (state.meta === null) {
    state.meta = document.createElement("span");
    state.meta.className = "omora-suggestion-meta";
    state.button.append(state.meta);
  }
  if (state.meta.textContent !== meta) {
    state.meta.textContent = meta;
  }
}

function createSuggestion(node: Node, ctx: RenderContext): HTMLElement {
  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute("role", "option");
  button.className = "omora-suggestion";
  button.dataset.type = "suggestion";
  const title = document.createElement("span");
  title.className = "omora-suggestion-title";
  button.append(title);
  const state: SuggestionState = {
    ctx,
    button,
    title,
    meta: null,
    handler: undefined,
    value: prop(node, "value") ?? "",
    onClick: () => undefined,
  };
  suggestionStates.set(button, state);
  state.onClick = () => {
    if (state.handler !== undefined) {
      state.ctx.event(state.handler, { value: state.value });
    }
  };
  button.addEventListener("click", state.onClick);
  ctx.cleanup(() => button.removeEventListener("click", state.onClick));
  syncSuggestion(state, node);
  return button;
}

// —— result ——

interface ResultState {
  ctx: RenderContext;
  title: HTMLButtonElement;
  snippet: HTMLParagraphElement;
  meta: HTMLSpanElement;
  handler: string | undefined;
  onClick: () => void;
}

const resultStates = new WeakMap<HTMLElement, ResultState>();

function syncResult(state: ResultState, node: Node): void {
  state.handler = handlerOf(node, "click");
  if (state.handler === undefined) {
    state.title.removeAttribute("data-handler");
  } else {
    state.title.dataset.handler = state.handler;
  }
  const title = prop(node, "title") ?? "";
  if (state.title.textContent !== title) {
    state.title.textContent = title;
  }
  setMarked(state.snippet, prop(node, "snippet") ?? "", prop(node, "highlight"));
  const meta = prop(node, "meta") ?? "";
  if (state.meta.textContent !== meta) {
    state.meta.textContent = meta;
  }
}

function createResult(node: Node, ctx: RenderContext): HTMLElement {
  const el = document.createElement("li");
  el.className = "omora-result";
  el.dataset.type = "result";
  const title = document.createElement("button");
  title.type = "button";
  title.className = "omora-result-title";
  const snippet = document.createElement("p");
  snippet.className = "omora-result-snippet";
  const meta = document.createElement("span");
  meta.className = "omora-result-meta";
  el.append(title, snippet, meta);
  const state: ResultState = {
    ctx,
    title,
    snippet,
    meta,
    handler: undefined,
    onClick: () => undefined,
  };
  resultStates.set(el, state);
  state.onClick = () => {
    if (state.handler !== undefined) {
      state.ctx.event(state.handler, {});
    }
  };
  title.addEventListener("click", state.onClick);
  ctx.cleanup(() => title.removeEventListener("click", state.onClick));
  syncResult(state, node);
  return el;
}

// —— tabs ——

interface TabsState {
  ctx: RenderContext;
  root: HTMLDivElement;
  bar: HTMLDivElement;
  base: string;
  buttons: HTMLButtonElement[];
  /** 每页一个稳定 wrapper，childrenHosts 按子节点下标返回。 */
  panels: HTMLDivElement[];
  nodes: Node[];
  active: number;
  onKeyDown: (event: KeyboardEvent) => void;
}

const tabsStates = new WeakMap<HTMLElement, TabsState>();

function ensureTabsPanels(state: TabsState, count: number): void {
  while (state.panels.length < count) {
    const index = state.panels.length;
    const panel = document.createElement("div");
    panel.className = "omora-tabs-panel";
    panel.setAttribute("role", "tabpanel");
    panel.id = state.base + "-panel-" + String(index);
    panel.setAttribute("aria-labelledby", state.base + "-tab-" + String(index));
    state.root.append(panel);
    state.panels.push(panel);
  }
  for (const [index, panel] of state.panels.entries()) {
    if (index < count) {
      if (panel.parentElement !== state.root) {
        state.root.append(panel);
      }
    } else if (panel.parentElement !== null) {
      panel.remove();
    }
  }
}

function syncTabs(state: TabsState): void {
  const count = state.nodes.length;
  if (count === 0) {
    state.active = -1;
  } else {
    state.active = Math.min(Math.max(state.active, 0), count - 1);
  }
  state.buttons.forEach((button, index) => {
    const selected = index === state.active;
    button.setAttribute("aria-selected", selected ? "true" : "false");
    button.className = selected ? "omora-tab is-active" : "omora-tab";
  });
  state.panels.forEach((panel, index) => {
    panel.hidden = index !== state.active;
  });
}

function buildTabs(state: TabsState, node: Node): void {
  state.nodes = childNodes(node);
  const count = state.nodes.length;
  while (state.buttons.length < count) {
    const index = state.buttons.length;
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("role", "tab");
    button.className = "omora-tab";
    button.id = state.base + "-tab-" + String(index);
    button.setAttribute("aria-controls", state.base + "-panel-" + String(index));
    const onClick = (): void => {
      state.active = index;
      syncTabs(state);
    };
    button.addEventListener("click", onClick);
    state.ctx.cleanup(() => button.removeEventListener("click", onClick));
    state.bar.append(button);
    state.buttons.push(button);
  }
  while (state.buttons.length > count) {
    const button = state.buttons.pop();
    button?.remove();
  }
  state.buttons.forEach((button, index) => {
    const label = headingOf(state.nodes[index]);
    if (button.textContent !== label) {
      button.textContent = label;
    }
  });
  ensureTabsPanels(state, count);
  syncTabs(state);
}

function onTabsKeyDown(state: TabsState, event: KeyboardEvent): void {
  const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
  const count = state.nodes.length;
  if (delta === 0 || count === 0) {
    return;
  }
  event.preventDefault();
  state.active = (((state.active + delta) % count) + count) % count;
  syncTabs(state);
}

function createTabs(node: Node, ctx: RenderContext): HTMLElement {
  const root = element("div", "omora-tabs");
  root.dataset.type = "tabs";
  const bar = element("div", "omora-tabs-bar");
  bar.setAttribute("role", "tablist");
  root.append(bar);
  const state: TabsState = {
    ctx,
    root,
    bar,
    base: nextId("tabs"),
    buttons: [],
    panels: [],
    nodes: [],
    active: 0,
    onKeyDown: () => undefined,
  };
  tabsStates.set(root, state);
  state.onKeyDown = (event) => onTabsKeyDown(state, event);
  bar.addEventListener("keydown", state.onKeyDown);
  ctx.cleanup(() => bar.removeEventListener("keydown", state.onKeyDown));
  buildTabs(state, node);
  return root;
}

// —— accordion ——

interface AccordionState {
  ctx: RenderContext;
  root: HTMLDivElement;
  sections: HTMLElement[];
  heads: HTMLButtonElement[];
  titles: HTMLSpanElement[];
  marks: HTMLSpanElement[];
  /** 每节一个内容 wrapper，childrenHosts 按子节点下标返回。 */
  bodies: HTMLDivElement[];
  nodes: Node[];
  open: number | null;
}

const accordionStates = new WeakMap<HTMLElement, AccordionState>();

function syncAccordion(state: AccordionState): void {
  state.sections.forEach((section, index) => {
    const expanded = index === state.open;
    section.dataset.open = expanded ? "true" : "false";
    const head = state.heads[index];
    const title = state.titles[index];
    const mark = state.marks[index];
    const body = state.bodies[index];
    if (head === undefined || title === undefined || mark === undefined || body === undefined) {
      return;
    }
    head.setAttribute("aria-expanded", expanded ? "true" : "false");
    const label = headingOf(state.nodes[index]);
    if (title.textContent !== label) {
      title.textContent = label;
    }
    const glyph = expanded ? "−" : "+";
    if (mark.textContent !== glyph) {
      mark.textContent = glyph;
    }
    body.hidden = !expanded;
  });
}

function toggleAccordion(state: AccordionState, index: number): void {
  if (index < 0 || index >= state.sections.length) {
    return;
  }
  state.open = state.open === index ? null : index;
  syncAccordion(state);
}

function ensureAccordionSections(state: AccordionState, count: number): void {
  while (state.sections.length < count) {
    const index = state.sections.length;
    const section = document.createElement("section");
    section.className = "omora-accordion-item";
    const head = document.createElement("button");
    head.type = "button";
    head.className = "omora-accordion-head";
    const title = document.createElement("span");
    title.className = "omora-accordion-title";
    const mark = document.createElement("span");
    mark.className = "omora-accordion-mark";
    mark.setAttribute("aria-hidden", "true");
    head.append(title, mark);
    const onToggle = (): void => toggleAccordion(state, index);
    head.addEventListener("click", onToggle);
    state.ctx.cleanup(() => head.removeEventListener("click", onToggle));
    const body = document.createElement("div");
    body.className = "omora-accordion-body";
    section.append(head, body);
    state.root.append(section);
    state.sections.push(section);
    state.heads.push(head);
    state.titles.push(title);
    state.marks.push(mark);
    state.bodies.push(body);
  }
  while (state.sections.length > count) {
    const section = state.sections.pop();
    state.heads.pop();
    state.titles.pop();
    state.marks.pop();
    state.bodies.pop();
    section?.remove();
  }
}

function buildAccordion(state: AccordionState, node: Node): void {
  state.nodes = childNodes(node);
  ensureAccordionSections(state, state.nodes.length);
  syncAccordion(state);
}

function createAccordion(node: Node, ctx: RenderContext): HTMLElement {
  const root = element("div", "omora-accordion");
  root.dataset.type = "accordion";
  const initial = numeric(node, "open");
  const state: AccordionState = {
    ctx,
    root,
    sections: [],
    heads: [],
    titles: [],
    marks: [],
    bodies: [],
    nodes: [],
    open: initial === undefined ? null : initial,
  };
  accordionStates.set(root, state);
  buildAccordion(state, node);
  return root;
}

// —— 注册表 ——

export const navKinds: KindRegistry = {
  search: {
    create: createSearch,
    update(el, node) {
      const state = searchStates.get(el);
      if (state !== undefined) {
        syncSearch(state, node);
      }
    },
    destroy: destroySearch,
    childrenHosts(el, node) {
      const state = searchStates.get(el);
      if (state === undefined) {
        return null;
      }
      const count = childNodes(node).length;
      ensureSearchOptions(state, count);
      return state.options.slice(0, count);
    },
  },
  suggestion: {
    create: createSuggestion,
    update(el, node) {
      const state = suggestionStates.get(el);
      if (state !== undefined) {
        syncSuggestion(state, node);
      }
    },
  },
  result: {
    create: createResult,
    update(el, node) {
      const state = resultStates.get(el);
      if (state !== undefined) {
        syncResult(state, node);
      }
    },
  },
  tabs: {
    create: createTabs,
    update(el, node) {
      const state = tabsStates.get(el);
      if (state !== undefined) {
        buildTabs(state, node);
      }
    },
    childrenHosts(el, node) {
      const state = tabsStates.get(el);
      if (state === undefined) {
        return null;
      }
      const count = childNodes(node).length;
      ensureTabsPanels(state, count);
      return state.panels.slice(0, count);
    },
  },
  accordion: {
    create: createAccordion,
    update(el, node) {
      const state = accordionStates.get(el);
      if (state !== undefined) {
        buildAccordion(state, node);
      }
    },
    childrenHosts(el, node) {
      const state = accordionStates.get(el);
      if (state === undefined) {
        return null;
      }
      const count = childNodes(node).length;
      ensureAccordionSections(state, count);
      return state.bodies.slice(0, count);
    },
  },
};

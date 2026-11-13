import type { Node } from "../renderer/types";
import { highlightParts, keyAction } from "../search/searchText";
import { handlerOf } from "../renderer/events";
import { iconGlyph } from "./icons";
import type { KindRegistry, RenderContext } from "../renderer/types";

export const SEARCH_DEBOUNCE_MS = 200;

function prop(node: Node, name: string): string | undefined {
  const value = node.props[name];
  return typeof value === "string" ? value : undefined;
}

function childNodes(node: Node): Node[] {
  return Array.isArray(node.children) ? node.children : [];
}

const markedKeys = new WeakMap<HTMLElement, string>();

function setMarked(el: HTMLElement, text: string, query: string | undefined): void {
  const key = (query ?? "") + "\u0000" + text;
  if (markedKeys.get(el) === key) {
    return;
  }
  markedKeys.set(el, key);
  const fragment = document.createDocumentFragment();
  for (const segment of highlightParts(text, query)) {
    const part = document.createElement(segment.hit ? "mark" : "span");
    part.textContent = segment.text;
    fragment.append(part);
  }
  el.replaceChildren(fragment);
}

interface SearchState {
  ctx: RenderContext;
  root: HTMLDivElement;
  input: HTMLInputElement;
  submit: HTMLButtonElement;
  list: HTMLDivElement;
  options: HTMLDivElement[];
  nodes: Node[];
  text: string;
  lastSent: string;
  queryHandler: string | undefined;
  submitHandler: string | undefined;
  active: number;
  dismissed: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  destroyed: boolean;
}

const searchStates = new WeakMap<HTMLElement, SearchState>();

function stopTimer(state: SearchState): void {
  if (state.timer !== null) clearTimeout(state.timer);
  state.timer = null;
}
const searchOpen = (state: SearchState): boolean => !state.dismissed && state.nodes.length > 0;
function syncChrome(state: SearchState): void {
  state.active = Math.max(-1, Math.min(state.active, state.nodes.length - 1));
  const open = searchOpen(state);
  state.list.hidden = !open;
  state.root.dataset.open = open ? "true" : "false";
  state.input.setAttribute("aria-expanded", open ? "true" : "false");
  state.options.forEach((option, index) => {
    option.classList.toggle("omora-search-option--active", index === state.active);
  });
}
function ensureOptions(state: SearchState, count: number): void {
  while (state.options.length < count) {
    const option = document.createElement("div");
    option.className = "omora-search-option";
    option.setAttribute("role", "presentation");
    state.options.push(option);
  }
  state.options.forEach((option, index) => {
    if (index >= count) {
      option.remove();
      return;
    }
    const current = state.list.children[index] ?? null;
    if (current !== option) {
      state.list.insertBefore(option, current);
    }
  });
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
  ensureOptions(state, state.nodes.length);
  syncChrome(state);
}
function deliver(state: SearchState, handler: string, value: string): void {
  stopTimer(state);
  state.lastSent = value;
  state.text = value;
  state.input.value = value;
  state.dismissed = true;
  state.active = -1;
  syncChrome(state);
  state.ctx.event(handler, { value });
}
function askSearch(state: SearchState): void {
  stopTimer(state);
  const handler = state.queryHandler;
  if (handler === undefined) {
    return;
  }
  const next = state.text;
  state.timer = setTimeout(() => {
    state.timer = null;
    if (state.destroyed) {
      return;
    }
    state.lastSent = next;
    state.ctx.event(handler, { value: next });
  }, SEARCH_DEBOUNCE_MS);
}
function submitSearch(state: SearchState): void {
  const trimmed = state.text.trim();
  const handler = state.submitHandler;
  if (trimmed.length === 0 || handler === undefined) {
    return;
  }
  deliver(state, handler, trimmed);
}
function pickSearch(state: SearchState, index: number): void {
  const suggestion = state.nodes[index];
  if (suggestion === undefined) {
    return;
  }
  const value = prop(suggestion, "value");
  const handler = handlerOf(suggestion, "pick");
  if (value === undefined || handler === undefined) {
    return;
  }
  deliver(state, handler, value);
}
function onSearchInput(state: SearchState): void {
  state.text = state.input.value;
  state.dismissed = false;
  state.active = -1;
  syncChrome(state);
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
    syncChrome(state);
  } else if (action.kind === "close") {
    state.dismissed = true;
    state.active = -1;
    syncChrome(state);
  } else if (action.kind === "pick") {
    pickSearch(state, action.active ?? -1);
  } else {
    submitSearch(state);
  }
}
function createSearch(node: Node, ctx: RenderContext): HTMLElement {
  const root = document.createElement("div");
  root.className = "omora-search";
  root.dataset.type = "search";
  root.dataset.open = "false";
  const row = document.createElement("div");
  row.className = "omora-search-row";
  const icon = document.createElement("span");
  icon.className = "omora-search-icon";
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
  const list = document.createElement("div");
  list.className = "omora-search-list";
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
  };
  searchStates.set(root, state);
  const onInput = (): void => onSearchInput(state);
  const onKeyDown = (event: KeyboardEvent): void => onSearchKeyDown(state, event);
  const onSubmit = (): void => submitSearch(state);
  input.addEventListener("input", onInput);
  input.addEventListener("keydown", onKeyDown);
  submit.addEventListener("click", onSubmit);
  ctx.cleanup(() => {
    state.destroyed = true;
    stopTimer(state);
    input.removeEventListener("input", onInput);
    input.removeEventListener("keydown", onKeyDown);
    submit.removeEventListener("click", onSubmit);
  });
  syncSearch(state, node);
  return root;
}
interface SuggestionState {
  button: HTMLButtonElement;
  title: HTMLSpanElement;
  meta: HTMLSpanElement | null;
  handler: string | undefined;
  value: string;
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
  const meta = prop(node, "meta") ?? "";
  if (meta.length === 0) {
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
  const state: SuggestionState = { button, title, meta: null, handler: undefined, value: "" };
  suggestionStates.set(button, state);
  const fire = (): void => {
    if (state.handler !== undefined) {
      ctx.event(state.handler, { value: state.value });
    }
  };
  button.addEventListener("click", fire);
  ctx.cleanup(() => button.removeEventListener("click", fire));
  syncSuggestion(state, node);
  return button;
}
interface ResultState {
  title: HTMLButtonElement;
  snippet: HTMLParagraphElement;
  meta: HTMLSpanElement;
  handler: string | undefined;
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
  const state: ResultState = { title, snippet, meta, handler: undefined };
  resultStates.set(el, state);
  const fire = (): void => {
    if (state.handler !== undefined) {
      ctx.event(state.handler, {});
    }
  };
  title.addEventListener("click", fire);
  ctx.cleanup(() => title.removeEventListener("click", fire));
  syncResult(state, node);
  return el;
}

function updater<T>(
  states: WeakMap<HTMLElement, T>,
  sync: (state: T, node: Node) => void,
): (el: HTMLElement, node: Node) => void {
  return (el, node) => {
    const state = states.get(el);
    if (state !== undefined) {
      sync(state, node);
    }
  };
}

function searchHosts(el: HTMLElement, node: Node): (HTMLElement | null)[] | null {
  const state = searchStates.get(el);
  if (state === undefined) {
    return null;
  }
  const count = childNodes(node).length;
  ensureOptions(state, count);
  return state.options.slice(0, count);
}

export const searchKinds: KindRegistry = {
  search: {
    create: createSearch,
    update: updater(searchStates, syncSearch),
    childrenHosts: searchHosts,
  },
  suggestion: {
    create: createSuggestion,
    update: updater(suggestionStates, syncSuggestion),
  },
  result: {
    create: createResult,
    update: updater(resultStates, syncResult),
  },
};

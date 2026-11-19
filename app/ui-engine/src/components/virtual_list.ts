/**
 * 虚拟列表 kind：@tanstack/virtual-core 只管窗口计算，DOM 由这里建。
 *
 * props：
 * - items: string[]（先用字符串行；collection 投影下一步）
 * - rowHeight?: number，缺省 32
 *
 * 只有可见窗口 + overscan 的行在 DOM 里；scroll 与尺寸由 virtualizer 观察。
 */

import {
  Virtualizer,
  elementScroll,
  observeElementOffset,
  observeElementRect,
  type VirtualizerOptions,
} from "@tanstack/virtual-core";
import type { KindRegistry, Node, RenderContext } from "../renderer/types";

const DEFAULT_ROW_HEIGHT = 32;
const OVERSCAN = 6;
const INITIAL_HEIGHT = 640;

interface VirtualListState {
  readonly root: HTMLDivElement;
  readonly spacer: HTMLDivElement;
  readonly rows: Map<number, HTMLDivElement>;
  items: string[];
  rowHeight: number;
  ready: boolean;
  virtualizer: Virtualizer<HTMLDivElement, HTMLElement>;
  cleanup: () => void;
}

const states = new WeakMap<HTMLElement, VirtualListState>();

function itemsOf(node: Node): string[] {
  const value = node.props.items;
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => {
    if (typeof item === "string") {
      return item;
    }
    if (typeof item !== "object" || item === null) {
      return String(item);
    }
    const record = item as Record<string, unknown>;
    const text = record.title ?? record.text ?? record.label;
    return typeof text === "string" ? text : JSON.stringify(item);
  });
}

function rowHeightOf(node: Node): number {
  const value = node.props.rowHeight;
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : DEFAULT_ROW_HEIGHT;
}

function render(state: VirtualListState): void {
  if (!state.ready) {
    return;
  }
  state.virtualizer._willUpdate();
  const visible = state.virtualizer.getVirtualItems();
  const wanted = new Set(visible.map((item) => item.index));
  for (const [index, element] of state.rows) {
    if (!wanted.has(index)) {
      element.remove();
      state.rows.delete(index);
    }
  }
  for (const item of visible) {
    let element = state.rows.get(item.index);
    if (element === undefined) {
      element = document.createElement("div");
      element.className = "omora-virtual-row";
      element.dataset.index = String(item.index);
      state.rows.set(item.index, element);
      state.spacer.append(element);
    }
    const text = state.items[item.index] ?? "";
    if (element.textContent !== text) {
      element.textContent = text;
    }
    element.style.transform = "translateY(" + String(item.start) + "px)";
    element.style.height = String(item.size) + "px";
  }
  state.spacer.style.height = String(state.virtualizer.getTotalSize()) + "px";
}

function optionsOf(state: VirtualListState): VirtualizerOptions<HTMLDivElement, HTMLElement> {
  return {
    count: state.items.length,
    getScrollElement: () => state.root,
    estimateSize: () => state.rowHeight,
    overscan: OVERSCAN,
    initialRect: { width: 0, height: INITIAL_HEIGHT },
    scrollToFn: (offset, options, instance) => elementScroll(offset, options, instance),
    observeElementRect: (instance, callback) => observeElementRect(instance, callback),
    observeElementOffset: (instance, callback) => observeElementOffset(instance, callback),
    onChange: () => render(state),
  };
}

function create(node: Node, _ctx: RenderContext): HTMLElement {
  const root = document.createElement("div");
  root.className = "omora-virtual-list";
  root.dataset.type = "virtual-list";
  root.style.overflowY = "auto";
  root.style.height = "100%";
  const spacer = document.createElement("div");
  spacer.className = "omora-virtual-spacer";
  root.append(spacer);
  const state: VirtualListState = {
    root,
    spacer,
    rows: new Map(),
    items: itemsOf(node),
    rowHeight: rowHeightOf(node),
    ready: false,
    virtualizer: null as unknown as Virtualizer<HTMLDivElement, HTMLElement>,
    cleanup: () => undefined,
  };
  state.virtualizer = new Virtualizer<HTMLDivElement, HTMLElement>(optionsOf(state));
  state.cleanup = state.virtualizer._didMount();
  state.ready = true;
  states.set(root, state);
  render(state);
  return root;
}

function update(el: HTMLElement, node: Node): void {
  const state = states.get(el);
  if (state === undefined) {
    return;
  }
  state.items = itemsOf(node);
  state.rowHeight = rowHeightOf(node);
  state.virtualizer.setOptions(optionsOf(state));
  render(state);
}

function destroy(el: HTMLElement): void {
  const state = states.get(el);
  if (state === undefined) {
    return;
  }
  state.ready = false;
  state.cleanup();
  states.delete(el);
}

export const virtualListKinds: KindRegistry = {
  "virtual-list": {
    create,
    update,
    destroy,
    childrenHosts: () => null,
  },
};

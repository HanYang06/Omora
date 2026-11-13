import type { Node } from "../core/types";
import type { KindRegistry, RenderContext } from "../renderer/types";

function prop(node: Node, name: string): string | undefined {
  const value = node.props[name];
  return typeof value === "string" ? value : undefined;
}

function textOf(node: Node): string {
  const value = node.props.text;
  return typeof value === "string" ? value : "";
}

function childNodes(node: Node): Node[] {
  return Array.isArray(node.children) ? node.children : [];
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

let uid = 0;

function nextId(prefix: string): string {
  uid += 1;
  return "omora-" + prefix + "-" + String(uid);
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
  state.panels.forEach((panel, index) => {
    if (index < count) {
      if (panel.parentElement !== state.root) {
        state.root.append(panel);
      }
    } else if (panel.parentElement !== null) {
      panel.remove();
    }
  });
}

function syncTabs(state: TabsState): void {
  const count = state.nodes.length;
  state.active = count === 0 ? -1 : Math.min(Math.max(state.active, 0), count - 1);
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
    state.buttons.pop()?.remove();
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
  const root = document.createElement("div");
  root.className = "omora-tabs";
  root.dataset.type = "tabs";
  const bar = document.createElement("div");
  bar.className = "omora-tabs-bar";
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
  const root = document.createElement("div");
  root.className = "omora-accordion";
  root.dataset.type = "accordion";
  const initial = node.props.open;
  const open = typeof initial === "number" && Number.isFinite(initial) ? initial : null;
  const state: AccordionState = {
    ctx,
    root,
    sections: [],
    heads: [],
    titles: [],
    marks: [],
    bodies: [],
    nodes: [],
    open,
  };
  accordionStates.set(root, state);
  buildAccordion(state, node);
  return root;
}

export const navKinds: KindRegistry = {
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

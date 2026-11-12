import type { Node } from "../../core/types";
import { handlerOf } from "../events";
import type { Kind, KindRegistry, RenderContext } from "../types";

/**
 * 表单选择类 kind：switch / checkbox / radio / select / field / button_group。
 *
 * 勾选、单选、下拉都是受控的：状态由数据决定，交互时只把新值交回去；
 * 选项子节点是数据（select）或挂载点（field/button_group），由 childrenHosts 分配。
 */

/** 元素 → 当前节点；handler id 可能随更新变，事件里必须读最新的。 */
const nodeOf = new WeakMap<HTMLElement, Node>();

function propOf(node: Node, name: string): string | undefined {
  const value = node.props[name];
  return typeof value === "string" ? value : undefined;
}

function textOf(node: Node): string {
  const value = node.props.text;
  return typeof value === "string" ? value : "";
}

function flagOf(node: Node, name: string): boolean {
  return node.props[name] === true;
}

/** 监听 + 清理登记：卸载时按账本逆序撤销。 */
function listen(
  target: HTMLElement,
  name: string,
  listener: EventListener,
  ctx: RenderContext,
): void {
  target.addEventListener(name, listener);
  ctx.cleanup(() => {
    target.removeEventListener(name, listener);
  });
}

/** 聚焦中的控件不重写 value / selection。 */
function isFocused(el: HTMLElement): boolean {
  return el.ownerDocument.activeElement === el;
}

function required<T extends Element>(parent: ParentNode, selector: string): T {
  const el = parent.querySelector<T>(selector);
  if (el === null) {
    throw new Error(`表单控件缺少 ${selector}`);
  }
  return el;
}

/** 按 class 找直属子元素；不用 :scope，省得依赖选择器实现。 */
function childClass(parent: HTMLElement, className: string): HTMLElement | null {
  for (const child of Array.from(parent.children)) {
    if (child.classList.contains(className)) {
      return child as HTMLElement;
    }
  }
  return null;
}

/** 有 text 就画一行说明；text 变了原地改，没有就移除。 */
function syncCaption(parent: HTMLElement, node: Node, className: string): void {
  const text = textOf(node);
  const existing = childClass(parent, className);
  if (text.length === 0) {
    existing?.remove();
    return;
  }
  if (existing !== null) {
    if (existing.textContent !== text) {
      existing.textContent = text;
    }
    return;
  }
  const span = document.createElement("span");
  span.className = className;
  span.textContent = text;
  parent.appendChild(span);
}

/** 控件当前的 change handler；事件触发时再读，id 换了也不用旧值。 */
function changeHandler(el: HTMLElement): string | undefined {
  const current = nodeOf.get(el);
  return current === undefined ? undefined : handlerOf(current, "change");
}

interface ToggleOptions {
  type: string;
  className: string;
  inputClass: string;
  role?: string;
  sync: (el: HTMLElement, node: Node) => void;
}

/** switch / checkbox 共同结构：label 包一个受控 checkbox，再加一行文字。 */
function createToggle(node: Node, ctx: RenderContext, options: ToggleOptions): HTMLElement {
  const el = document.createElement("label");
  el.className = options.className;
  el.dataset.type = options.type;
  const field = document.createElement("input");
  field.type = "checkbox";
  field.className = options.inputClass;
  if (options.role !== undefined) {
    field.setAttribute("role", options.role);
  }
  el.appendChild(field);
  nodeOf.set(el, node);
  options.sync(el, node);
  listen(
    field,
    "change",
    () => {
      const handler = changeHandler(el);
      if (handler !== undefined) {
        ctx.event(handler, { value: field.checked });
      }
    },
    ctx,
  );
  return el;
}

function syncSwitch(el: HTMLElement, node: Node): void {
  const field = required<HTMLInputElement>(el, "input.omora-switch-input");
  const checked = flagOf(node, "checked");
  el.dataset.on = String(checked);
  field.checked = checked;
  field.disabled = handlerOf(node, "change") === undefined || flagOf(node, "disabled");
  field.setAttribute("aria-checked", String(checked));
  syncCaption(el, node, "omora-switch-text");
}

function syncCheckbox(el: HTMLElement, node: Node): void {
  const field = required<HTMLInputElement>(el, "input.omora-checkbox-input");
  field.checked = flagOf(node, "checked");
  field.disabled = handlerOf(node, "change") === undefined || flagOf(node, "disabled");
  syncCaption(el, node, "omora-checkbox-text");
}

const switchKind: Kind = {
  create(node, ctx) {
    return createToggle(node, ctx, {
      type: "switch",
      className: "omora-switch",
      inputClass: "omora-switch-input",
      role: "switch",
      sync: syncSwitch,
    });
  },
  update(el, node) {
    nodeOf.set(el, node);
    syncSwitch(el, node);
  },
  childrenHosts: () => null,
};

const checkbox: Kind = {
  create(node, ctx) {
    return createToggle(node, ctx, {
      type: "checkbox",
      className: "omora-checkbox",
      inputClass: "omora-checkbox-input",
      sync: syncCheckbox,
    });
  },
  update(el, node) {
    nodeOf.set(el, node);
    syncCheckbox(el, node);
  },
  childrenHosts: () => null,
};

function syncRadio(el: HTMLElement, node: Node): void {
  const field = required<HTMLInputElement>(el, "input.omora-radio-input");
  field.name = propOf(node, "name") ?? "";
  field.value = propOf(node, "value") ?? textOf(node);
  field.checked = flagOf(node, "checked");
  field.disabled = handlerOf(node, "change") === undefined || flagOf(node, "disabled");
  syncCaption(el, node, "omora-radio-text");
}

const radio: Kind = {
  create(node, ctx) {
    const el = document.createElement("label");
    el.className = "omora-radio";
    el.dataset.type = "radio";
    const field = document.createElement("input");
    field.type = "radio";
    field.className = "omora-radio-input";
    el.appendChild(field);
    nodeOf.set(el, node);
    syncRadio(el, node);
    listen(
      field,
      "change",
      () => {
        const handler = changeHandler(el);
        if (handler !== undefined) {
          ctx.event(handler, { value: field.value });
        }
      },
      ctx,
    );
    return el;
  },
  update(el, node) {
    nodeOf.set(el, node);
    syncRadio(el, node);
  },
  childrenHosts: () => null,
};

interface DesiredOption {
  value: string;
  label: string;
  placeholder: boolean;
}

/** 选项来自子节点（text）：label 是文字，value 缺省就是文字；placeholder 排最前。 */
function optionsOf(node: Node, placeholder: string | undefined): DesiredOption[] {
  const options: DesiredOption[] = [];
  if (placeholder !== undefined && placeholder.length > 0) {
    options.push({ value: "", label: placeholder, placeholder: true });
  }
  for (const child of node.children) {
    const label = textOf(child);
    options.push({ value: propOf(child, "value") ?? label, label, placeholder: false });
  }
  return options;
}

/** 按位置原地对齐 option：多退少补，不整体重建 select。 */
function syncOptions(select: HTMLSelectElement, desired: DesiredOption[]): void {
  const existing = Array.from(select.options);
  for (const [index, option] of desired.entries()) {
    let target = existing[index];
    if (target === undefined) {
      target = document.createElement("option");
      select.appendChild(target);
    }
    target.value = option.value;
    target.textContent = option.label;
    target.disabled = option.placeholder;
    target.hidden = option.placeholder;
  }
  for (const extra of Array.from(select.options).slice(desired.length)) {
    extra.remove();
  }
}

function syncSelect(el: HTMLElement, node: Node): void {
  const select = required<HTMLSelectElement>(el, "select.omora-select-input");
  const placeholder = propOf(node, "placeholder");
  const value = propOf(node, "value") ?? "";
  select.disabled = handlerOf(node, "change") === undefined || flagOf(node, "disabled");
  if (placeholder !== undefined && placeholder.length > 0) {
    select.setAttribute("aria-label", placeholder);
  } else {
    select.removeAttribute("aria-label");
  }
  syncOptions(select, optionsOf(node, placeholder));
  if (!isFocused(select)) {
    select.value = value;
    if (value === "" && placeholder !== undefined && placeholder.length > 0) {
      select.selectedIndex = 0;
    }
  }
}

const select: Kind = {
  create(node, ctx) {
    const el = document.createElement("div");
    el.className = "omora-select";
    el.dataset.type = "select";
    const field = document.createElement("select");
    field.className = "omora-select-input";
    el.appendChild(field);
    nodeOf.set(el, node);
    syncSelect(el, node);
    listen(
      field,
      "change",
      () => {
        const handler = changeHandler(el);
        if (handler !== undefined) {
          ctx.event(handler, { value: field.value });
        }
      },
      ctx,
    );
    return el;
  },
  update(el, node) {
    nodeOf.set(el, node);
    syncSelect(el, node);
  },
  childrenHosts: () => null,
};

function syncField(el: HTMLElement, node: Node): void {
  const control = required<HTMLElement>(el, ".omora-field-control");
  const label = propOf(node, "label") ?? "";
  const currentLabel = childClass(el, "omora-field-label");
  if (label.length === 0) {
    currentLabel?.remove();
  } else if (currentLabel === null) {
    const span = document.createElement("span");
    span.className = "omora-field-label";
    span.textContent = label;
    el.insertBefore(span, control);
  } else if (currentLabel.textContent !== label) {
    currentLabel.textContent = label;
  }
  const hint = propOf(node, "hint");
  const currentHint = childClass(el, "omora-field-hint");
  if (hint === undefined || hint.length === 0) {
    currentHint?.remove();
  } else if (currentHint === null) {
    const span = document.createElement("span");
    span.className = "omora-field-hint";
    span.textContent = hint;
    el.appendChild(span);
  } else if (currentHint.textContent !== hint) {
    currentHint.textContent = hint;
  }
}

const field: Kind = {
  create(node) {
    const el = document.createElement("div");
    el.className = "omora-field";
    el.dataset.type = "field";
    const control = document.createElement("div");
    control.className = "omora-field-control";
    el.appendChild(control);
    nodeOf.set(el, node);
    syncField(el, node);
    return el;
  },
  update(el, node) {
    nodeOf.set(el, node);
    syncField(el, node);
  },
  // 子节点挂在稳定的 wrapper 上，label / hint 在它前后原地增删。
  childrenHosts: (el) => [el.querySelector<HTMLElement>(".omora-field-control")],
};

const buttonGroup: Kind = {
  create() {
    const el = document.createElement("div");
    el.className = "omora-button-group";
    el.dataset.type = "button_group";
    el.setAttribute("role", "group");
    return el;
  },
  // 按钮组直接用自身当挂载点。
  childrenHosts: (el) => [el],
};

export const formChoiceKinds: KindRegistry = {
  switch: switchKind,
  checkbox,
  radio,
  select,
  field,
  button_group: buttonGroup,
};

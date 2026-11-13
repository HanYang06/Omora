import type { Node } from "../renderer/types";
import { handlerOf } from "../renderer/events";
import type { Kind, KindRegistry, RenderContext } from "../renderer/types";

/** 表单输入类 kind：button / input / textarea / number_input / slider / progress。 */

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

/** props 里的数字；Python 的 int / float 到这儿是 number，也收数字字符串。 */
function numericOf(node: Node, name: string): number | undefined {
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

/** input / textarea 的 value 只用于预填：数据值变了、且用户没在输入时才写。 */
function syncTextValue(
  field: HTMLInputElement | HTMLTextAreaElement,
  node: Node,
  previous: Node | undefined,
): void {
  if (previous !== undefined && previous.props.value === node.props.value) {
    return;
  }
  if (isFocused(field)) {
    return;
  }
  field.value = propOf(node, "value") ?? "";
}

/** 数字属性：undefined 就不画这个属性。 */
function setNumberAttribute(el: HTMLElement, name: string, value: number | undefined): void {
  if (value === undefined) {
    el.removeAttribute(name);
  } else {
    el.setAttribute(name, String(value));
  }
}

function syncButton(el: HTMLButtonElement, node: Node): void {
  const handler = handlerOf(node, "click");
  const variant = propOf(node, "variant");
  el.className = variant === "ghost" ? "omora-button omora-button--ghost" : "omora-button";
  el.dataset.type = "button";
  if (handler === undefined) {
    el.removeAttribute("data-handler");
  } else {
    el.dataset.handler = handler;
  }
  el.disabled = handler === undefined;
  el.textContent = textOf(node);
}

const button: Kind = {
  create(node, ctx) {
    const el = document.createElement("button");
    el.type = "button";
    nodeOf.set(el, node);
    syncButton(el, node);
    listen(
      el,
      "click",
      () => {
        const current = nodeOf.get(el);
        const handler = current === undefined ? undefined : handlerOf(current, "click");
        if (handler !== undefined) {
          ctx.event(handler, {});
        }
      },
      ctx,
    );
    return el;
  },
  update(el, node) {
    nodeOf.set(el, node);
    syncButton(el as HTMLButtonElement, node);
  },
  childrenHosts: () => null,
};

function syncInput(wrapper: HTMLElement, node: Node, previous: Node | undefined): void {
  const input = required<HTMLInputElement>(wrapper, "input.omora-capture-input");
  input.placeholder = propOf(node, "placeholder") ?? "";
  syncTextValue(input, node, previous);
  if (propOf(node, "value") !== undefined) {
    wrapper.querySelector(".omora-capture-plus")?.remove();
    wrapper.querySelector(".omora-capture-hint")?.remove();
    return;
  }
  if (wrapper.querySelector(".omora-capture-plus") === null) {
    const plus = document.createElement("span");
    plus.className = "omora-capture-plus";
    plus.setAttribute("aria-hidden", "true");
    plus.textContent = "+";
    wrapper.insertBefore(plus, input);
  }
  if (wrapper.querySelector(".omora-capture-hint") === null) {
    const hint = document.createElement("span");
    hint.className = "omora-capture-hint";
    hint.setAttribute("aria-hidden", "true");
    hint.textContent = "回车";
    wrapper.appendChild(hint);
  }
}

const input: Kind = {
  create(node, ctx) {
    const wrapper = document.createElement("div");
    wrapper.className = "omora-capture";
    wrapper.dataset.type = "input";
    const field = document.createElement("input");
    field.className = "omora-capture-input";
    wrapper.appendChild(field);
    nodeOf.set(wrapper, node);
    syncInput(wrapper, node, undefined);
    listen(
      field,
      "keydown",
      (event) => {
        if (!(event instanceof KeyboardEvent) || event.key !== "Enter") {
          return;
        }
        const current = nodeOf.get(wrapper);
        const handler = current === undefined ? undefined : handlerOf(current, "submit");
        if (handler === undefined) {
          return;
        }
        const value = field.value.trim();
        if (value.length === 0) {
          return;
        }
        ctx.event(handler, { value });
        field.value = "";
      },
      ctx,
    );
    return wrapper;
  },
  update(el, node) {
    const previous = nodeOf.get(el);
    nodeOf.set(el, node);
    syncInput(el, node, previous);
  },
  childrenHosts: () => null,
};

function submitTextarea(el: HTMLTextAreaElement, ctx: RenderContext): void {
  const current = nodeOf.get(el);
  const handler = current === undefined ? undefined : handlerOf(current, "submit");
  if (handler !== undefined) {
    ctx.event(handler, { value: el.value });
  }
}

function syncTextarea(el: HTMLTextAreaElement, node: Node, previous: Node | undefined): void {
  el.placeholder = propOf(node, "placeholder") ?? "";
  el.rows = numericOf(node, "rows") ?? 3;
  el.disabled = flagOf(node, "disabled");
  syncTextValue(el, node, previous);
}

const textarea: Kind = {
  create(node, ctx) {
    const el = document.createElement("textarea");
    el.className = "omora-textarea";
    el.dataset.type = "textarea";
    nodeOf.set(el, node);
    syncTextarea(el, node, undefined);
    listen(el, "blur", () => submitTextarea(el, ctx), ctx);
    listen(
      el,
      "keydown",
      (event) => {
        if (!(event instanceof KeyboardEvent) || event.key !== "Enter") {
          return;
        }
        if (!event.ctrlKey && !event.metaKey) {
          return;
        }
        event.preventDefault();
        submitTextarea(el, ctx);
      },
      ctx,
    );
    return el;
  },
  update(el, node) {
    const previous = nodeOf.get(el);
    nodeOf.set(el, node);
    syncTextarea(el as HTMLTextAreaElement, node, previous);
  },
  childrenHosts: () => null,
};

function changeHandler(el: HTMLElement): string | undefined {
  const current = nodeOf.get(el);
  return current === undefined ? undefined : handlerOf(current, "change");
}

function syncNumberInput(el: HTMLInputElement, node: Node, previous: Node | undefined): void {
  setNumberAttribute(el, "min", numericOf(node, "min"));
  setNumberAttribute(el, "max", numericOf(node, "max"));
  setNumberAttribute(el, "step", numericOf(node, "step"));
  el.disabled = flagOf(node, "disabled");
  if (previous !== undefined && previous.props.value === node.props.value) {
    return;
  }
  if (isFocused(el)) {
    return;
  }
  const value = numericOf(node, "value");
  el.value = value === undefined ? "" : String(value);
}

const numberInput: Kind = {
  create(node, ctx) {
    const el = document.createElement("input");
    el.type = "number";
    el.className = "omora-number";
    el.dataset.type = "number_input";
    nodeOf.set(el, node);
    syncNumberInput(el, node, undefined);
    listen(
      el,
      "change",
      () => {
        const handler = changeHandler(el);
        if (handler === undefined || el.value.length === 0) {
          return;
        }
        const parsed = Number(el.value);
        if (Number.isFinite(parsed)) {
          ctx.event(handler, { value: parsed });
        }
      },
      ctx,
    );
    return el;
  },
  update(el, node) {
    const previous = nodeOf.get(el);
    nodeOf.set(el, node);
    syncNumberInput(el as HTMLInputElement, node, previous);
  },
  childrenHosts: () => null,
};

function syncSlider(el: HTMLInputElement, node: Node, previous: Node | undefined): void {
  setNumberAttribute(el, "min", numericOf(node, "min") ?? 0);
  setNumberAttribute(el, "max", numericOf(node, "max") ?? 100);
  setNumberAttribute(el, "step", numericOf(node, "step"));
  el.disabled = flagOf(node, "disabled");
  if (previous !== undefined && previous.props.value === node.props.value) {
    return;
  }
  if (isFocused(el)) {
    return;
  }
  el.value = String(numericOf(node, "value") ?? 0);
}

const slider: Kind = {
  create(node, ctx) {
    const el = document.createElement("input");
    el.type = "range";
    el.className = "omora-slider";
    el.dataset.type = "slider";
    nodeOf.set(el, node);
    syncSlider(el, node, undefined);
    listen(
      el,
      "change",
      () => {
        const handler = changeHandler(el);
        if (handler === undefined) {
          return;
        }
        const parsed = Number(el.value);
        if (Number.isFinite(parsed)) {
          ctx.event(handler, { value: parsed });
        }
      },
      ctx,
    );
    return el;
  },
  update(el, node) {
    const previous = nodeOf.get(el);
    nodeOf.set(el, node);
    syncSlider(el as HTMLInputElement, node, previous);
  },
  childrenHosts: () => null,
};

function syncProgress(el: HTMLElement, node: Node): void {
  const max = numericOf(node, "max") ?? 100;
  const value = numericOf(node, "value") ?? 0;
  const now = Math.min(Math.max(value, 0), max);
  const ratio = max > 0 ? now / max : 0;
  const percent = Math.round(Math.min(Math.max(ratio, 0), 1) * 1000) / 10;
  el.setAttribute("aria-valuemin", "0");
  el.setAttribute("aria-valuemax", String(max));
  el.setAttribute("aria-valuenow", String(now));
  const fill = required<HTMLElement>(el, ".omora-progress-fill");
  fill.style.width = `${percent}%`;
  const caption = el.querySelector<HTMLElement>(".omora-progress-text");
  const text = textOf(node);
  if (text.length === 0) {
    caption?.remove();
  } else if (caption === null) {
    const span = document.createElement("span");
    span.className = "omora-progress-text";
    span.textContent = text;
    el.appendChild(span);
  } else if (caption.textContent !== text) {
    caption.textContent = text;
  }
}

const progress: Kind = {
  create(node) {
    const el = document.createElement("div");
    el.className = "omora-progress";
    el.dataset.type = "progress";
    el.setAttribute("role", "progressbar");
    const track = document.createElement("div");
    track.className = "omora-progress-track";
    const fill = document.createElement("div");
    fill.className = "omora-progress-fill";
    track.appendChild(fill);
    el.appendChild(track);
    nodeOf.set(el, node);
    syncProgress(el, node);
    return el;
  },
  update(el, node) {
    nodeOf.set(el, node);
    syncProgress(el, node);
  },
  childrenHosts: () => null,
};

export const formKinds: KindRegistry = {
  button,
  input,
  textarea,
  number_input: numberInput,
  slider,
  progress,
};

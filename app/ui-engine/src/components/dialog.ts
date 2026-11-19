/**
 * dialog kind：原生 <dialog> + showModal()，焦点陷阱、Esc、返回焦点都交给平台。
 *
 * props：
 * - open: boolean，是否以模态打开
 * - label?: string，落到 aria-label
 *
 * 事件：close。children 挂进 dialog 内部。
 */

import { handlerOf } from "../renderer/events";
import type { KindRegistry, Node, RenderContext } from "../renderer/types";

interface DialogState {
  readonly ctx: RenderContext;
  readonly dialog: HTMLDialogElement;
  closeHandler: string | undefined;
  node: Node;
  onClose: () => void;
}

const states = new WeakMap<HTMLElement, DialogState>();

function labelOf(node: Node): string | undefined {
  const value = node.props.label;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function syncDialog(dialog: HTMLDialogElement, node: Node): void {
  const open = node.props.open === true;
  if (open && !dialog.open) {
    try {
      dialog.showModal();
    } catch {
      // 还没连到 document 时 showModal 会抛；下一帧再试。
    }
  } else if (!open && dialog.open) {
    dialog.close();
  }
  const label = labelOf(node);
  if (label === undefined) {
    dialog.removeAttribute("aria-label");
  } else {
    dialog.setAttribute("aria-label", label);
  }
}

function create(node: Node, ctx: RenderContext): HTMLElement {
  const dialog = document.createElement("dialog");
  dialog.className = "omora-dialog";
  dialog.dataset.type = "dialog";
  const state: DialogState = {
    ctx,
    dialog,
    closeHandler: handlerOf(node, "close"),
    node,
    onClose: () => undefined,
  };
  state.onClose = (): void => {
    const handler = state.closeHandler;
    if (handler !== undefined) {
      ctx.event(handler, {});
    }
  };
  dialog.addEventListener("close", state.onClose);
  states.set(dialog, state);
  syncDialog(dialog, node);
  // create 时还没插进 DOM，等挂载完成后再打开。
  queueMicrotask(() => {
    const current = states.get(dialog);
    if (current !== undefined) {
      syncDialog(dialog, current.node);
    }
  });
  return dialog;
}

function update(el: HTMLElement, node: Node): void {
  const state = states.get(el);
  if (state === undefined) {
    return;
  }
  state.node = node;
  state.closeHandler = handlerOf(node, "close");
  syncDialog(state.dialog, node);
}

function destroy(el: HTMLElement): void {
  const state = states.get(el);
  if (state === undefined) {
    return;
  }
  state.dialog.removeEventListener("close", state.onClose);
  if (state.dialog.open) {
    state.dialog.close();
  }
  states.delete(el);
}

export const dialogKinds: KindRegistry = {
  dialog: {
    create,
    update,
    destroy,
    childrenHosts: (el) => [el],
  },
};

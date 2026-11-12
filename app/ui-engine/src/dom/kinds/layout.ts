import type { Node } from "../../core/types";
import type { KindRegistry } from "../types";

function renderColumn(el: HTMLElement, node: Node): void {
  el.className = "omora-column";
  el.dataset.type = "column";
  void node;
}

/** 布局类 kind；其余由 teammate 在本文件内补齐。 */
export const layoutKinds: KindRegistry = {
  column: {
    create(node) {
      const el = document.createElement("div");
      renderColumn(el, node);
      return el;
    },
    update(el, node) {
      renderColumn(el, node);
    },
  },
};

import type { Node } from "../../core/types";
import type { KindRegistry } from "../types";

function renderText(el: HTMLElement, node: Node): void {
  const kind = node.props.kind;
  el.className =
    kind === "title"
      ? "omora-text omora-text--title"
      : kind === "muted"
        ? "omora-text omora-text--muted"
        : "omora-text";
  el.dataset.type = "text";
  el.dataset.kind = typeof kind === "string" ? kind : "body";
  const text = node.props.text;
  el.textContent = typeof text === "string" ? text : "";
}

export const basicKinds: KindRegistry = {
  text: {
    create(node) {
      const el = document.createElement("span");
      renderText(el, node);
      return el;
    },
    update(el, node) {
      renderText(el, node);
    },
  },
};

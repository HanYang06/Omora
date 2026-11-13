import type { JsonObject } from "../contract/protocol";
import type { Node } from "../renderer/types";
import { registry } from "./registry";
import { DomRenderer } from "../renderer/renderer";
import type { RenderContext } from "../renderer/types";

export interface RecordedEvent {
  handler: string;
  payload?: JsonObject;
}

export interface Mounted {
  root: HTMLElement;
  renderer: DomRenderer;
  events: RecordedEvent[];
  render(node: Node): void;
  destroy(): void;
}

/** 测试 helper：jsdom 里挂一棵树，记录发出去的事件。 */
export function mount(node: Node): Mounted {
  const events: RecordedEvent[] = [];
  const context: RenderContext = {
    event: (handler, payload) => events.push({ handler, payload }),
    loadMedia: () => Promise.resolve({ mime: "", data: "" }),
    cleanup: () => undefined,
  };
  const container = document.createElement("div");
  document.body.appendChild(container);
  const renderer = new DomRenderer({ registry, context });
  renderer.render(node, container);
  return {
    root: container,
    renderer,
    events,
    render: (next) => renderer.render(next, container),
    destroy: () => {
      renderer.dispose();
      container.remove();
    },
  };
}

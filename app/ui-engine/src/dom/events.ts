import type { Node } from "../core/types";

/**
 * v1.5 事件解析：优先 node.events[event]，再回退 props.on_<event>。
 * 所有 kind 用这一个入口，避免两条事件路径各写一套。
 */
export function handlerOf(node: Node, event: string): string | undefined {
  const fromEvents = node.events?.[event];
  if (typeof fromEvents === "string" && fromEvents.length > 0) {
    return fromEvents;
  }
  const prop = node.props["on_" + event];
  return typeof prop === "string" && prop.length > 0 ? prop : undefined;
}

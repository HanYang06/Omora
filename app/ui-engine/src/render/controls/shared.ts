import { prop, textOf } from "../../core/shared";
import type { EventHandler, Node } from "../../core/types";

/** 控件共用的三个小工具：读数字、包事件、取条目名。 */

/** props 里的数字。Python 的 int / float 到这儿是 number；也收数字字符串。 */
export function numeric(node: Node, name: string): number | undefined {
  const value = node.props?.[name];
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export interface Binding {
  /** 有没有挂 handler id：没有就画成禁用。 */
  active: boolean;
  emit: (payload: Record<string, unknown>) => void;
}

/** 把 props 里的 handler id 包成"有 id 才发"的发射器。 */
export function binding(node: Node, name: string, onEvent: EventHandler | undefined): Binding {
  const handler = prop(node, name);
  const active = handler !== undefined && handler.length > 0;
  return {
    active,
    emit: (payload) => {
      if (handler !== undefined && handler.length > 0) {
        onEvent?.(handler, payload);
      }
    },
  };
}

/** 条目的头：props.label 优先，其次 title，最后是文字本身。 */
export function headingOf(item: Node | undefined): string {
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

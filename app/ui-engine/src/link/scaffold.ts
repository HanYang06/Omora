/**
 * 窗口根骨架（Dendrolink 结构文档 §7）。
 *
 * 链接期编译器拿它当 `base`；挂载目标 `dendro.window.nav` / `dendro.window.page`
 * 由局部树按 `mountAt` 填。骨架是只读常量：链接器先深拷再改，改不到这里。
 */

import type { SlotNode } from "../contract/document";

function deepFreeze<T>(value: T): T {
  if (Array.isArray(value)) {
    for (const item of value) {
      deepFreeze(item);
    }
    return Object.freeze(value) as T;
  }
  if (typeof value === "object" && value !== null) {
    for (const item of Object.values(value)) {
      deepFreeze(item);
    }
    return Object.freeze(value);
  }
  return value;
}

/** 三栏母壳的根：图标栏（56px）+ 主区；两栏都由页面来源填。 */
export const WINDOW_SCAFFOLD: SlotNode = deepFreeze<SlotNode>({
  id: "dendro.window",
  kind: "dendro:window",
  owner: "dendro",
  props: {},
  layout: { flow: "row", capacity: "many" },
  children: [
    {
      id: "dendro.window.nav",
      kind: "dendro:slot",
      owner: "dendro",
      props: {},
      layout: { flow: "column", capacity: "many", size: { width: 56 } },
      children: [],
    },
    {
      id: "dendro.window.page",
      kind: "dendro:slot",
      owner: "dendro",
      props: {},
      layout: { flow: "column", capacity: "one", size: { width: "fill" } },
      children: [],
    },
  ],
});

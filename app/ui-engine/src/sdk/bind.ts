/**
 * Page 层：Bind 单向绑定（契约 schema/sdk/page.json -> bind）。
 *
 * source 是 page 的 state 路径或 host 提供的 data 路径；mount / invalidate 时把值写到
 * node.props[prop]。只向下写，从不回写 state / data（twoWay=false）。
 */

import type { Page } from "./page";
import type { Node } from "./scope";

export interface BindDescriptor {
  /** 写到 node.props 的键。 */
  prop: string;
  /** `state.<path>` 或 `data.<path>`。 */
  source: string;
}

export function assertBindSource(source: string): void {
  if (!source.startsWith("state.") && !source.startsWith("data.")) {
    throw new TypeError("bind.source 必须是 state.* 或 data.*: " + source);
  }
}

function readPath(base: unknown, path: readonly string[]): unknown {
  let current = base;
  for (const key of path) {
    if (typeof current !== "object" || current === null) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/** 读 Bind 来源；缺失的路径返回 undefined。 */
export function readBindSource(page: Page, source: string): unknown {
  const [root, ...path] = source.split(".");
  const base = root === "state" ? page.state : page.hostData;
  return readPath(base, path);
}

/** 把一个节点上的全部 Bind 求值并写进 props（一次 patch）。 */
export function resolveBind(page: Page, node: Node, bindings: readonly BindDescriptor[]): void {
  const props: Record<string, unknown> = {};
  for (const binding of bindings) {
    props[binding.prop] = readBindSource(page, binding.source);
  }
  node.patch({ props });
}

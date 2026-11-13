/**
 * renderer 的纯工具与共享类型：节点 key、children、未知 kind 占位、旧树遍历、
 * 以及每次渲染的节点统计零值。拆出来只为让 renderer 本体守住行数预算；统计类型
 * 在 contract/render。
 */

import type { RenderStats } from "../contract/render";
import type { Node } from "../core/types";
import type { Kind } from "./types";

export interface Rendered {
  key: string;
  type: string;
  node: Node;
  el: HTMLElement;
  kind: Kind;
  /** 元素当前所在的宿主；null 表示这个节点不落 DOM（kind 自己消费 children）。 */
  host: HTMLElement | null;
  childHosts: (HTMLElement | null)[];
  children: Rendered[];
  cleanups: (() => void)[];
}

export function keyOf(node: Node, fallback: string): string {
  return typeof node.id === "string" && node.id.length > 0 ? node.id : fallback;
}

export function childNodes(node: Node): Node[] {
  return Array.isArray(node.children) ? node.children : [];
}

export function placeholder(type: string, failed: boolean): HTMLElement {
  const el = document.createElement("div");
  el.className = "omora-unknown";
  el.dataset.type = "unknown";
  if (failed) {
    el.dataset.failed = "true";
  } else {
    el.dataset.unknownType = type;
  }
  el.textContent = failed ? "这一块暂时显示不出来" : "未知组件: " + (type || "(空)");
  return el;
}

export const UNKNOWN_KIND: Kind = {
  create(node) {
    return placeholder(node.type, false);
  },
};

/** 旧树的先序展开；销毁时倒序走，保证子条目先于父条目。 */
export function collectOrder(entry: Rendered, out: Rendered[]): void {
  out.push(entry);
  for (const child of entry.children) {
    collectOrder(child, out);
  }
}

export function zeroStats(): RenderStats {
  return { created: 0, updated: 0, reused: 0, removed: 0 };
}

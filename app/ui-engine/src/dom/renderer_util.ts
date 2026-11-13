/**
 * renderer 的纯工具与共享类型：节点 key、children、未知 kind 占位、旧树遍历、
 * 以及每次渲染的节点统计（RenderStats）。拆出来只为让 renderer 本体守住行数预算。
 */

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

/**
 * 一次渲染对节点做的事：新建 / 更新 / 复用 / 销毁；数值都描述**最近一次** render。
 *
 * created 与 reused 互补（同一次渲染里每个存活的条目恰好落进一个），updated 是 reused
 * 的子集：复用的元素里真正执行了 kind.update 的那部分。这样既能看「这轮复用了多少节点」，
 * 也能看「其中有多少真的被更新」。
 */
export interface RenderStats {
  /** 本次新建的条目数（含未知 kind 的占位、create 失败后的占位）。 */
  created: number;
  /** 复用旧元素且实际调用了 kind.update 的条目数（是 reused 的子集）。 */
  updated: number;
  /** 本次复用旧元素的条目数（含调了 update 的、memo 跳过的、kind 没有 update 的）。 */
  reused: number;
  /** 本次销毁的旧条目数（含换根整棵弃用、同 key 换 type、update 失败的旧子树）。 */
  removed: number;
}

export function zeroStats(): RenderStats {
  return { created: 0, updated: 0, reused: 0, removed: 0 };
}

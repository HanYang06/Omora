/**
 * addr 解析与旧 addr 重定向：当前树索引 + 旧 addr → 节点 id（null = 墓碑）。
 *
 * 索引按根引用缓存：引擎每次成功 apply 都换根引用，缓存自然失效。
 */

import type { SlotNode } from "../contract/document";
import { DocumentIndex } from "../engine/document/document";
import type { WireOp } from "../engine/document/ops";

/** 收集结构 op 会碰到的节点旧 addr；mount 没有旧节点，route 不碰树。 */
export function oldAddrsFor(index: DocumentIndex, ops: readonly WireOp[]): Map<string, string> {
  const addrs = new Map<string, string>();
  for (const op of ops) {
    let id: string | undefined;
    switch (op.op) {
      case "update":
      case "move":
      case "unmount":
      case "replace":
        id = op.id;
        break;
      case "mount":
      case "route":
        break;
    }
    if (id === undefined) {
      continue;
    }
    const addr = index.get(id)?.addr;
    if (addr !== undefined) {
      addrs.set(addr, id);
    }
  }
  return addrs;
}

export class AddrState {
  private cacheRoot: SlotNode | null = null;
  private cacheIndex: DocumentIndex | null = null;
  private readonly redirects = new Map<string, string | null>();

  /** 当前根树的索引；根引用没变就复用。 */
  index(root: SlotNode): DocumentIndex {
    if (this.cacheRoot === root && this.cacheIndex !== null) {
      return this.cacheIndex;
    }
    const index = DocumentIndex.build(root);
    this.cacheRoot = root;
    this.cacheIndex = index;
    return index;
  }

  /** applyOps 前：当前索引 + 这批 op 的旧 addr。 */
  begin(root: SlotNode, ops: readonly WireOp[]): Map<string, string> {
    return oldAddrsFor(this.index(root), ops);
  }

  /** 先查当前 addr，再查旧 addr → id；墓碑返回 undefined。 */
  resolve(addr: string, root: SlotNode): SlotNode | undefined {
    const index = this.index(root);
    const direct = index.getByAddr(addr);
    if (direct !== undefined) {
      return direct;
    }
    const target = this.redirects.get(addr);
    if (target === undefined || target === null) {
      return undefined;
    }
    return index.get(target);
  }

  /** 结构变化后记录旧 addr → id；节点没了写墓碑，replace 换 id 时转给新节点。 */
  note(root: SlotNode, oldAddrs: ReadonlyMap<string, string>, changed: readonly string[]): void {
    const next = this.index(root);
    for (const [addr, id] of oldAddrs) {
      const stillThere = next.get(id);
      if (stillThere !== undefined) {
        if (stillThere.addr !== addr) {
          this.redirects.set(addr, id);
        }
        continue;
      }
      const replacement = changed.length === 1 ? changed[0] : undefined;
      if (replacement !== undefined && next.get(replacement) !== undefined) {
        this.redirects.set(addr, replacement);
      } else {
        this.redirects.set(addr, null);
      }
    }
  }

  clear(): void {
    this.redirects.clear();
    this.cacheRoot = null;
    this.cacheIndex = null;
  }
}

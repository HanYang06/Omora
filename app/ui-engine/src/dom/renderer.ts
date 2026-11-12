import type { Node } from "../core/types";
import type { Kind, KindRegistry, RenderContext } from "./types";

interface Rendered {
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

export interface DomRendererOptions {
  registry: KindRegistry;
  context: RenderContext;
}

/**
 * 一次渲染的构建现场。
 *
 * - previous：上一次渲染的 key → 条目索引，只读；
 * - used：本次已经认领的旧条目，每个旧条目最多用一次（防重复 id 重复认领）；
 * - blocked：本次不可复用的旧子树（同 key 换 type / update 失败 / 换根），整棵弃用；
 * - next：本次渲染产出的新索引，渲染结束替换 previous。
 */
interface BuildState {
  previous: Map<string, Rendered>;
  used: Set<Rendered>;
  blocked: Set<Rendered>;
  next: Map<string, Rendered>;
}

function keyOf(node: Node, fallback: string): string {
  return typeof node.id === "string" && node.id.length > 0 ? node.id : fallback;
}

function childNodes(node: Node): Node[] {
  return Array.isArray(node.children) ? node.children : [];
}

function placeholder(type: string, failed: boolean): HTMLElement {
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

const UNKNOWN_KIND: Kind = {
  create(node) {
    return placeholder(node.type, false);
  },
};

/** 旧树的先序展开；销毁时倒序走，保证子条目先于父条目。 */
function collectOrder(entry: Rendered, out: Rendered[]): void {
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

function zeroStats(): RenderStats {
  return { created: 0, updated: 0, reused: 0, removed: 0 };
}

/**
 * node ↔ DOM 协调：有 id 用 id，没有用父路径+位置；未变的节点引用整棵跳过。
 *
 * 渲染分三步：先按 key 构建/复用（跨父也能认出同一条目），再统一重排 DOM，
 * 最后销毁没被认领的旧条目。没有第二棵虚拟树：元素就是状态，更新直接落到元素上。
 *
 * 渲染统计（`stats`）不改上面任何协调语义，只在过程中记账；语义固定为：
 * - `created`：本次新建的条目数。kind.create 失败后换占位、未知 kind 画占位都算新建；
 * - `reused`：本次复用旧元素的条目数，按条目逐个计。包括：
 *   1. 调了 `kind.update` 的条目；
 *   2. node 引用没变、整棵被 memo 跳过的子树（`claimSubtree` 认领的条目同样各计一次；
 *      根引用没变时整棵树按 memo 跳过、不遍历，直接按上次渲染的条目数记）；
 *   3. 同 key / 同 type、但 kind 没实现 `update` 的条目——元素复用，更新无事可做；
 * - `updated`：`reused` 里真的执行了 `kind.update` 的那部分（**子集**，不是独立分类）；
 * - `removed`：本次销毁的旧条目数。换根整棵弃用、同 key 换 type、update 失败的旧子树、
 *   `childrenHosts` 为空时没人认领的旧子条目，都按条目逐个计。
 * 不变量：普通渲染里 `created + reused` = 本次树里的条目数；`updated <= reused`；
 * 根引用没变时 `created = updated = removed = 0`、`reused` = 上次渲染的条目数。
 *
 * 每次 `render` 开头先清零再计数，所以 `stats` 永远只描述最近一次 render；
 * `dispose` 不参与统计（不计数也不清零，保持最后一次 render 的值）。`stats` 返回副本，
 * 调用方改它不影响渲染器。统计只属于渲染器：上报给指标是宿主（DocumentView）的事。
 */
export class DomRenderer {
  private readonly registry: KindRegistry;
  private readonly context: RenderContext;
  private root: Rendered | null = null;
  private index = new Map<string, Rendered>();
  private renderStats: RenderStats = zeroStats();
  /** 上一轮渲染的条目总数；根引用没变时整棵树 memo 跳过，用它报 reused。 */
  private entryCount = 0;

  constructor(options: DomRendererOptions) {
    this.registry = options.registry;
    this.context = options.context;
  }

  /** 最近一次 render 的节点统计；返回副本，dispose 不清零。 */
  get stats(): RenderStats {
    return { ...this.renderStats };
  }

  render(node: Node, parent: HTMLElement): void {
    const previous = this.root;
    this.renderStats = zeroStats();
    if (previous !== null && previous.node === node) {
      // 根引用没变：整棵树按 memo 跳过，不遍历；上一轮的每个条目都算复用。
      this.renderStats.reused = this.entryCount;
      return;
    }
    const state: BuildState = {
      previous: this.index,
      used: new Set(),
      blocked: new Set(),
      next: new Map(),
    };
    const order: Rendered[] = [];
    if (previous !== null) {
      collectOrder(previous, order);
      // 根节点整体换掉时，旧树不再提供任何可复用元素（与按父协调时的重建语义一致）。
      if (!rootCanBeReused(previous, node)) {
        this.blockSubtree(previous, state);
      }
    }
    const root = this.build(node, "$root", parent, state);
    this.attachRoot(root, previous, parent);
    this.arrange(root);
    this.destroyUnused(order, state);
    this.root = root;
    this.index = state.next;
    // 新树的条目数 = 新建 + 复用（updated 是 reused 的子集，不重复加）；
    // 根引用没变时整树 memo 跳过，直接拿它报 reused。
    this.entryCount = this.renderStats.created + this.renderStats.reused;
  }

  dispose(): void {
    const root = this.root;
    if (root === null) {
      return;
    }
    const order: Rendered[] = [];
    collectOrder(root, order);
    for (let index = order.length - 1; index >= 0; index -= 1) {
      const entry = order[index];
      if (entry !== undefined) {
        this.destroy(entry);
      }
    }
    this.root = null;
    this.index = new Map();
  }

  private nodeContext(cleanups: (() => void)[]): RenderContext {
    return {
      event: (handler, payload) => this.context.event(handler, payload),
      loadMedia: (media) => this.context.loadMedia(media),
      cleanup: (dispose) => cleanups.push(dispose),
    };
  }

  /** 按 key 找旧条目；能复用就复用（update / 整棵跳过），否则建新条目。 */
  private build(
    node: Node,
    fallbackKey: string,
    host: HTMLElement | null,
    state: BuildState,
  ): Rendered {
    const key = keyOf(node, fallbackKey);
    const candidate = state.previous.get(key);
    const takeable =
      candidate !== undefined && !state.used.has(candidate) && !state.blocked.has(candidate);
    if (takeable && candidate.type === node.type) {
      if (candidate.node === node) {
        this.place(candidate, host);
        this.claimSubtree(candidate, state);
        return candidate;
      }
      if (this.updateEntry(candidate, node, host, state)) {
        return candidate;
      }
      this.blockSubtree(candidate, state);
    } else if (takeable) {
      // 同 key 换 type：旧元素和它的子树都不复用。
      this.blockSubtree(candidate, state);
    }
    return this.createEntry(node, key, host, state);
  }

  private createEntry(
    node: Node,
    key: string,
    host: HTMLElement | null,
    state: BuildState,
  ): Rendered {
    const cleanups: (() => void)[] = [];
    const kind = this.registry[node.type] ?? UNKNOWN_KIND;
    let el: HTMLElement;
    try {
      el = kind.create(node, this.nodeContext(cleanups));
    } catch (error) {
      console.error("[omora] kind create 失败:", node.type, error);
      el = placeholder(node.type, true);
    }
    const entry: Rendered = {
      key,
      type: node.type,
      node,
      el,
      kind,
      host,
      childHosts: [],
      children: [],
      cleanups,
    };
    this.renderStats.created += 1;
    entry.childHosts = this.hostsOf(entry);
    this.claim(entry, state);
    this.buildChildren(entry, node, state);
    return entry;
  }

  /** 复用旧元素：失败返回 false，旧条目留给销毁阶段。 */
  private updateEntry(
    entry: Rendered,
    node: Node,
    host: HTMLElement | null,
    state: BuildState,
  ): boolean {
    const cleanups: (() => void)[] = [];
    const callsUpdate = entry.kind.update !== undefined;
    try {
      entry.kind.update?.(entry.el, node, this.nodeContext(cleanups));
    } catch (error) {
      console.error("[omora] kind update 失败:", node.type, error);
      // update 里登记过的清理也要记在旧条目上，销毁时一起跑。
      entry.cleanups.push(...cleanups);
      return false;
    }
    // 元素复用按条目计入 reused；调了 update 的再单独计入 updated（updated ⊆ reused）。
    this.renderStats.reused += 1;
    if (callsUpdate) {
      this.renderStats.updated += 1;
    }
    entry.cleanups.push(...cleanups);
    entry.node = node;
    this.place(entry, host);
    entry.childHosts = this.hostsOf(entry);
    this.claim(entry, state);
    this.buildChildren(entry, node, state);
    return true;
  }

  private buildChildren(entry: Rendered, node: Node, state: BuildState): void {
    entry.children = [];
    if (entry.childHosts.length === 0) {
      // kind 自己消费 children 数据（如 select 的选项）；旧子条目没人认领，会被销毁。
      return;
    }
    for (const [index, child] of childNodes(node).entries()) {
      const host = this.hostAt(entry, index);
      entry.children.push(this.build(child, entry.key + "/" + String(index), host, state));
    }
  }

  /** 认领旧条目：标记已用，并写进新索引（重复 key 首个生效）。 */
  private claim(entry: Rendered, state: BuildState): void {
    state.used.add(entry);
    if (!state.next.has(entry.key)) {
      state.next.set(entry.key, entry);
    }
  }

  /** 整棵跳过：元素只可能换宿主，内部结构不动，子孙条目全部视为已用。 */
  private claimSubtree(entry: Rendered, state: BuildState): void {
    this.renderStats.reused += 1;
    this.claim(entry, state);
    for (const child of entry.children) {
      this.claimSubtree(child, state);
    }
  }

  private blockSubtree(entry: Rendered, state: BuildState): void {
    state.blocked.add(entry);
    for (const child of entry.children) {
      this.blockSubtree(child, state);
    }
  }

  /** 复用元素前先把它从旧宿主摘下来，避免旧宿主里残留。 */
  private place(entry: Rendered, host: HTMLElement | null): void {
    if (entry.host === host) {
      return;
    }
    entry.host = host;
    entry.el.remove();
  }

  private attachRoot(root: Rendered, previous: Rendered | null, parent: HTMLElement): void {
    root.host = parent;
    if (previous === null) {
      parent.appendChild(root.el);
      return;
    }
    if (root === previous) {
      if (previous.el.parentElement !== parent) {
        parent.appendChild(previous.el);
      }
      return;
    }
    // 换根：新根先占位，旧根留给销毁阶段移除。
    if (previous.el.parentElement === parent) {
      parent.replaceChild(root.el, previous.el);
    } else {
      parent.appendChild(root.el);
    }
  }

  /** 统一安排 DOM：同一宿主的子元素按下标重排；被移动过的元素已在构建时摘下。 */
  private arrange(entry: Rendered): void {
    const groups = new Map<HTMLElement, Rendered[]>();
    for (const child of entry.children) {
      const host = child.host;
      if (host === null) {
        continue;
      }
      const group = groups.get(host) ?? [];
      group.push(child);
      groups.set(host, group);
    }
    for (const [host, children] of groups) {
      for (const [index, child] of children.entries()) {
        const current = host.children[index] ?? null;
        if (current !== child.el) {
          host.insertBefore(child.el, current);
        }
      }
    }
    for (const child of entry.children) {
      this.arrange(child);
    }
  }

  private destroyUnused(order: Rendered[], state: BuildState): void {
    for (let index = order.length - 1; index >= 0; index -= 1) {
      const entry = order[index];
      if (entry === undefined || state.used.has(entry)) {
        continue;
      }
      this.renderStats.removed += 1;
      this.destroy(entry);
    }
  }

  private hostsOf(entry: Rendered): (HTMLElement | null)[] {
    if (entry.kind.childrenHosts === undefined) {
      return [entry.el];
    }
    try {
      const hosts = entry.kind.childrenHosts(entry.el, entry.node);
      return hosts === null ? [] : hosts;
    } catch (error) {
      console.error("[omora] childrenHosts 失败:", entry.type, error);
      return [];
    }
  }

  private hostAt(entry: Rendered, index: number): HTMLElement | null {
    if (entry.childHosts.length === 0) {
      return null;
    }
    return entry.childHosts[index] ?? entry.childHosts[entry.childHosts.length - 1] ?? null;
  }

  private destroy(entry: Rendered): void {
    if (entry.kind.destroy !== undefined) {
      try {
        entry.kind.destroy(entry.el);
      } catch (error) {
        console.error("[omora] kind destroy 失败:", entry.type, error);
      }
    }
    for (let index = entry.cleanups.length - 1; index >= 0; index -= 1) {
      const dispose = entry.cleanups[index];
      if (dispose !== undefined) {
        try {
          dispose();
        } catch (error) {
          console.error("[omora] 清理失败:", entry.type, error);
        }
      }
    }
    entry.el.remove();
  }
}

/** 新树根能否接在旧根上：key（有 id 用 id）与 type 都得一致。 */
function rootCanBeReused(previous: Rendered, node: Node): boolean {
  return previous.type === node.type && previous.key === keyOf(node, "$root");
}

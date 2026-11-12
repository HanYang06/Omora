import type { Node } from "../core/types";
import type { Kind, KindRegistry, RenderContext } from "./types";

interface Rendered {
  key: string;
  type: string;
  node: Node;
  el: HTMLElement;
  kind: Kind;
  childHost: HTMLElement | null;
  children: Rendered[];
  cleanups: (() => void)[];
}

export interface DomRendererOptions {
  registry: KindRegistry;
  context: RenderContext;
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

/**
 * node ↔ DOM 协调：有 id 用 id，没有用父路径+位置；未变的节点引用整棵跳过。
 *
 * 没有第二棵虚拟树：元素就是状态，更新直接落到元素上。
 */
export class DomRenderer {
  private readonly registry: KindRegistry;
  private readonly context: RenderContext;
  private root: Rendered | null = null;

  constructor(options: DomRendererOptions) {
    this.registry = options.registry;
    this.context = options.context;
  }

  render(node: Node, parent: HTMLElement): void {
    if (this.root === null) {
      this.root = this.create(node, "$root");
      parent.appendChild(this.root.el);
      return;
    }
    const previous = this.root;
    if (previous.node === node) {
      return;
    }
    const next = this.reconcile(previous, node, "$root");
    this.root = next;
    if (next.el !== previous.el) {
      parent.replaceChild(next.el, previous.el);
    }
  }

  dispose(): void {
    if (this.root === null) {
      return;
    }
    this.destroy(this.root);
    this.root = null;
  }

  private nodeContext(cleanups: (() => void)[]): RenderContext {
    return {
      event: (handler, payload) => this.context.event(handler, payload),
      loadMedia: (media) => this.context.loadMedia(media),
      cleanup: (dispose) => cleanups.push(dispose),
    };
  }

  private create(node: Node, fallbackKey: string): Rendered {
    const key = keyOf(node, fallbackKey);
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
      childHost: null,
      children: [],
      cleanups,
    };
    entry.childHost = this.hostOf(entry);
    if (entry.childHost !== null) {
      for (const [index, child] of childNodes(node).entries()) {
        const rendered = this.create(child, key + "/" + String(index));
        entry.children.push(rendered);
        entry.childHost.appendChild(rendered.el);
      }
    }
    return entry;
  }

  private reconcile(previous: Rendered, node: Node, fallbackKey: string): Rendered {
    if (previous.node === node) {
      return previous;
    }
    if (previous.type !== node.type) {
      this.destroy(previous);
      return this.create(node, fallbackKey);
    }
    const cleanups: (() => void)[] = [];
    try {
      previous.kind.update?.(previous.el, node, this.nodeContext(cleanups));
      previous.cleanups.push(...cleanups);
    } catch (error) {
      console.error("[omora] kind update 失败:", node.type, error);
      this.destroy(previous);
      return this.create(node, fallbackKey);
    }
    previous.node = node;
    previous.key = keyOf(node, fallbackKey);
    this.reconcileChildren(previous, node);
    return previous;
  }

  private reconcileChildren(entry: Rendered, node: Node): void {
    const host = entry.childHost;
    const newNodes = childNodes(node);
    if (host === null) {
      return;
    }
    const previousByKey = new Map(entry.children.map((child) => [child.key, child]));
    const next: Rendered[] = [];
    for (const [index, child] of newNodes.entries()) {
      const fallback = entry.key + "/" + String(index);
      const key = keyOf(child, fallback);
      const old = previousByKey.get(key);
      previousByKey.delete(key);
      if (old !== undefined && old.type === child.type) {
        next.push(this.reconcile(old, child, key));
      } else {
        if (old !== undefined) {
          this.destroy(old);
        }
        next.push(this.create(child, key));
      }
    }
    for (const removed of previousByKey.values()) {
      this.destroy(removed);
    }
    entry.children = next;
    for (const [index, child] of next.entries()) {
      const current = host.children[index] ?? null;
      if (current !== child.el) {
        host.insertBefore(child.el, current);
      }
    }
  }

  private hostOf(entry: Rendered): HTMLElement | null {
    if (entry.kind.childrenHost === undefined) {
      return entry.el;
    }
    try {
      return entry.kind.childrenHost(entry.el, entry.node);
    } catch (error) {
      console.error("[omora] childrenHost 失败:", entry.type, error);
      return null;
    }
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

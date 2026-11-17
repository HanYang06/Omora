/**
 * V1 tree 的 DOM 宿主：把 `TreeHost` 的三个动作落到 DOM。
 *
 * 一个渲染器实例可能对应多个子挂载点（tabs 的 panels、rail 的 list），所以宿主
 * 持有一组 host 元素：index → host 按 `childrenHosts` 的下标映射，越界回退到
 * 最后一个（与 `DomRenderer.hostAt` 一致）。
 *
 * 契约：同一实例的挂载点在生命周期内保持稳定；`replaceHosts` 只允许在末尾追加
 * （tabs 长出新面板），旧下标的元素必须还是同一个，否则直接抛错——换挂载点会让
 * 已挂的子节点丢。
 */

import type { TreeChildHandle, TreeHost } from "../../engine/tree/types";

interface Entry {
  handle: TreeChildHandle;
  index: number;
  el: HTMLElement;
}

function asElement(output: unknown): HTMLElement {
  if (!(output instanceof HTMLElement)) {
    throw new Error("V1 渲染输出不是 HTMLElement");
  }
  return output;
}

export class DomTreeHost implements TreeHost {
  private hosts: readonly HTMLElement[];
  private readonly entries: Entry[] = [];

  constructor(hosts: readonly HTMLElement[]) {
    if (hosts.length === 0) {
      throw new Error("DomTreeHost 至少需要一个挂载点");
    }
    this.hosts = hosts;
  }

  /** 只允许在末尾追加挂载点；已有下标必须是同一个元素。 */
  replaceHosts(next: readonly HTMLElement[]): void {
    if (next.length === 0) {
      throw new Error("DomTreeHost 至少需要一个挂载点");
    }
    this.hosts.forEach((host, index) => {
      if (next[index] !== host) {
        throw new Error("V1 子挂载点不能更换: index " + String(index));
      }
    });
    this.hosts = next;
    this.arrange();
  }

  mount(child: TreeChildHandle, index: number): void {
    this.entries.push({ handle: child, index, el: asElement(child.output) });
    this.arrange();
  }

  /**
   * 按 output 元素认领：replace 时 runtime 会给同一个元素新建 handle 对象
   * （reusedFrom 指向旧节点），按 handle 身份匹配会找不到。
   */
  private entryOf(output: TreeChildHandle["output"]): Entry | undefined {
    const el = asElement(output);
    return this.entries.find((candidate) => candidate.el === el);
  }

  update(child: TreeChildHandle, index: number): void {
    const entry = this.entryOf(child.output);
    if (entry === undefined) {
      throw new Error("DomTreeHost.update: 没有这个子节点");
    }
    entry.index = index;
    this.arrange();
  }

  unmount(child: TreeChildHandle): void {
    const el = asElement(child.output);
    const at = this.entries.findIndex((candidate) => candidate.el === el);
    if (at < 0) {
      return;
    }
    const [entry] = this.entries.splice(at, 1);
    entry?.el.remove();
  }

  private hostFor(index: number): HTMLElement {
    const host = this.hosts[Math.min(index, this.hosts.length - 1)] ?? this.hosts[0];
    if (host === undefined) {
      throw new Error("DomTreeHost 没有挂载点");
    }
    return host;
  }

  /** 按 index 重排：同宿主里只动我们拥有的元素，不碰宿主自己的静态内容。 */
  private arrange(): void {
    const groups = new Map<HTMLElement, Entry[]>();
    for (const entry of this.entries) {
      const host = this.hostFor(entry.index);
      const group = groups.get(host) ?? [];
      group.push(entry);
      groups.set(host, group);
    }
    for (const [host, group] of groups) {
      group.sort((left, right) => left.index - right.index);
      for (let index = group.length - 1; index >= 0; index -= 1) {
        const entry = group[index];
        if (entry === undefined) {
          continue;
        }
        const next = group[index + 1]?.el ?? null;
        if (entry.el.parentElement !== host || entry.el.nextElementSibling !== next) {
          host.insertBefore(entry.el, next);
        }
      }
    }
  }
}

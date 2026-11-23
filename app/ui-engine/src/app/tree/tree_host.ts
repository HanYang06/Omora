/**
 * V1 tree 的 DOM 宿主：把 `TreeHost` 的四个动作落到 DOM。
 *
 * 一个渲染器实例可能对应多个子挂载点（tabs 的 panels、rail 的 list），所以宿主
 * 持有一组 host 元素：index → host 按 `childrenHosts` 的下标映射，越界回退到
 * 最后一个（与 `DomRenderer.hostAt` 一致）。
 *
 * 重排的最小移动：同宿主里先按 index 排出目标顺序，用当前 DOM 顺序算出「相对顺序
 * 已经正确」的最长递增子序列（LIS）；LIS 里的元素原位不动，其余元素才 insertBefore。
 * 一次 `reorder` / `arrange` 里每个该动的元素只动一次，而不是逐个位置搬。
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

/** 最长严格递增子序列的下标；用于挑出「可以完全不动」的元素。 */
function increasingIndices(values: readonly number[]): number[] {
  const tails: number[] = [];
  const tailAt: number[] = [];
  const previous: number[] = [];
  values.forEach((value, position) => {
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      const tail = tails[middle];
      if (tail !== undefined && tail < value) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    tails[low] = value;
    tailAt[low] = position;
    previous[position] = low > 0 ? (tailAt[low - 1] ?? -1) : -1;
  });
  const result: number[] = [];
  let at = tails.length > 0 ? (tailAt[tails.length - 1] ?? -1) : -1;
  while (at >= 0) {
    result.push(at);
    at = previous[at] ?? -1;
  }
  return result.reverse();
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

  /**
   * 批量重排：children 是当前全部直接子节点的最终顺序。只 assign 一次 index、
   * arrange 一次；DOM 里只动 LIS 之外的元素。
   */
  reorder(children: readonly TreeChildHandle[]): void {
    if (children.length !== this.entries.length) {
      throw new Error(
        "DomTreeHost.reorder: 需要全部直接子节点（" +
          String(children.length) +
          " / " +
          String(this.entries.length) +
          "）",
      );
    }
    children.forEach((child, index) => {
      const entry = this.entryOf(child.output);
      if (entry === undefined) {
        throw new Error("DomTreeHost.reorder: 没有这个子节点");
      }
      entry.handle = child;
      entry.index = index;
    });
    this.arrange();
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
      this.placeGroup(host, group);
    }
  }

  /**
   * 一组同宿主元素归位：目标顺序 = 按 index 升序；当前顺序 = 已在该宿主里的 DOM 顺序。
   * LIS 里的元素保持不动，其余从右往左插到下一个元素前面——每个只 insertBefore 一次。
   */
  private placeGroup(host: HTMLElement, group: Entry[]): void {
    group.sort((left, right) => left.index - right.index);
    const owned = new Set<Element>(group.map((entry) => entry.el));
    const current = [...host.children].filter((el): el is HTMLElement => owned.has(el));
    const at = new Map<HTMLElement, number>(current.map((el, index) => [el, index]));
    const present: number[] = [];
    const desiredIndex: number[] = [];
    group.forEach((entry, index) => {
      const currentIndex = at.get(entry.el);
      if (currentIndex !== undefined) {
        present.push(currentIndex);
        desiredIndex.push(index);
      }
    });
    // LIS 用「当前 DOM 位置」序列算：递增 = 这些元素不用挪，相对顺序已经对。
    const stays = new Set<number>();
    for (const position of increasingIndices(present)) {
      const index = desiredIndex[position];
      if (index !== undefined) {
        stays.add(index);
      }
    }
    let next: HTMLElement | null = null;
    for (let index = group.length - 1; index >= 0; index -= 1) {
      const entry = group[index];
      if (entry === undefined) {
        continue;
      }
      const el = entry.el;
      if (!stays.has(index) && (el.parentElement !== host || el.nextElementSibling !== next)) {
        host.insertBefore(el, next);
      }
      next = el;
    }
  }
}

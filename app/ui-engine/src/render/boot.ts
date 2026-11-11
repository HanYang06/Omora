import type { PageEntry, Snapshot } from "../core/types";
import { STATIC_ORDER, STATIC_SNAPSHOTS } from "../generated/static-tree";

/**
 * 启动骨架：不等后端先画第一页。
 *
 * 产物是构建期冻结的结构（没有回调、meta 清空），只负责首帧；真快照一到就换掉。
 * 导航对不上说明产物旧了，记一条警告即可，不影响替换。
 */

/** 按顺序取第一份能用的快照。 */
export function bootSnapshot(
  snapshots: Record<string, Snapshot>,
  order: readonly string[],
): Snapshot | null {
  for (const name of order) {
    const snapshot = snapshots[name];
    if (snapshot !== undefined) {
      return snapshot;
    }
  }
  return null;
}

/** 两份导航是不是同一版：名字与标签都对齐。 */
export function pagesMatch(a: readonly PageEntry[], b: readonly PageEntry[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return a.every(
    (entry, index) => entry.name === b[index]?.name && entry.label === b[index]?.label,
  );
}

/** 骨架与后端报的不是同一版。 */
export function isStale(
  staticPages: readonly PageEntry[],
  livePages: readonly PageEntry[],
): boolean {
  return !pagesMatch(staticPages, livePages);
}

/** 这一版构建产出的启动骨架。 */
export function initialSnapshot(): Snapshot | null {
  return bootSnapshot(STATIC_SNAPSHOTS, STATIC_ORDER);
}

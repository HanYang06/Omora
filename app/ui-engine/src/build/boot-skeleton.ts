import { STATIC_ORDER, STATIC_VIEWS } from "../generated/static-view";
import { compileSlotSkeleton } from "./slot-skeleton";

/**
 * 构建期入口：取默认页（生成顺序的第一个）的首帧视图 → 链接 → 编译成 index.html 里的首帧。
 * 视图是空数据下由 Python 产出的骨架（scripts/static_ui.py）。
 */
export function compileBootSkeleton(): string {
  const name = STATIC_ORDER[0];
  const view = STATIC_VIEWS[name];
  if (view === undefined) {
    throw new Error("生成的启动骨架是空的（重新跑 scripts/static_ui.py）");
  }
  return compileSlotSkeleton(view);
}

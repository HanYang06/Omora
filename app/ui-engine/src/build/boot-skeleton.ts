import { initialSnapshot } from "../legacy/render/boot";
import { withContributions } from "../legacy/render/view";
import { compileSkeleton } from "./skeleton";

/**
 * 构建期入口：启动快照 + 贡献组合，编译成 index.html 里的首帧。
 *
 * 组合仍然走运行时同一个 `withContributions`，构建期不另写一套规则。
 */
export function compileBootSkeleton(): string {
  return compileSkeleton(withContributions(initialSnapshot()));
}

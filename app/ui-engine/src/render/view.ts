import type { Snapshot } from "../core/types";
import { compose } from "./compose";

/**
 * 把页面自己的树和别的插件的贡献合成一棵树。
 *
 * 没有贡献就原样返回（连引用都不换），有贡献才组合；组合器对未触碰的子树保持
 * 引用，所以渲染端的 memo 不受影响。
 */
export function withContributions(snapshot: Snapshot | null): Snapshot | null {
  if (snapshot === null) {
    return null;
  }
  const contributions = snapshot.contributions ?? [];
  if (contributions.length === 0) {
    return snapshot;
  }
  const { tree } = compose(snapshot.content, contributions);
  return tree === snapshot.content ? snapshot : { ...snapshot, content: tree };
}

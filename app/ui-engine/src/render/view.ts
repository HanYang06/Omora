import type { Node, Snapshot } from "../core/types";
import { OM_WINDOW_PAGE } from "../generated/keys";
import { compose } from "./compose";

/** 页面主树在窗口里的键：引擎组合前打在页面根上，整页因此可被 replace / before / after。 */
export const WINDOW_PAGE = OM_WINDOW_PAGE;

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
  const root: Node = {
    ...snapshot.content,
    props: { ...snapshot.content.props, key: WINDOW_PAGE },
  };
  const { tree } = compose(root, contributions);
  return tree === root ? snapshot : { ...snapshot, content: tree };
}

/**
 * 契约层：渲染节点统计（纯类型）。
 *
 * 一次渲染对节点做的事：新建 / 更新 / 复用 / 销毁；数值都描述**最近一次** render。
 * 从 dom/renderer_util.ts 抽到契约层：runtime 的指标 / 引擎只依赖这个统计形状，
 * 不再反向依赖渲染实现（dom/render）。
 *
 * created 与 reused 互补（同一次渲染里每个存活的条目恰好落进一个），updated 是 reused
 * 的子集：复用的元素里真正执行了 kind.update 的那部分。这样既能看「这轮复用了多少节点」，
 * 也能看「其中有多少真的被更新」。零值构造 zeroStats 留在渲染层，属 renderer 的实现
 * 细节。
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

/**
 * 构建期树 V1 组合器入口；实现已搬到 `link/tree_compose`（链接期组合，构建期与运行时共用）。
 *
 * `assertTreeComposes` 是门禁函数：成功返回唯一 document，失败抛 TreeComposeError；
 * `composeTree` 是同一实现的结果式 API：失败回诊断，不抛。
 */
export {
  TreeComposeError,
  assertTreeComposes,
  composeTree,
  type TreeComposeDiagnostic,
  type TreeComposeDiagnosticCode,
  type TreeComposeResult,
} from "../../link/tree_compose";

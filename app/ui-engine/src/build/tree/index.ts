/**
 * 构建期树 V1 组合器入口。
 *
 * `assertTreeComposes` 是门禁函数：成功返回唯一 document，失败抛 TreeComposeError；
 * `composeTree` 是同一实现的结果式 API：失败回诊断，不抛。两者都不接 Vite / 运行时。
 */
export {
  TreeComposeError,
  assertTreeComposes,
  composeTree,
  type TreeComposeDiagnostic,
  type TreeComposeDiagnosticCode,
  type TreeComposeResult,
} from "./compose";

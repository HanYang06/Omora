/**
 * V1 tree runtime：把已 compose 的 dendro.tree/1 文档挂到宿主。
 * 契约在 types.ts，校验在 validate.ts，编排在 runtime.ts，视图入口在 view.ts。
 */

export type * from "./types";
export * from "./apply";
export * from "./ops";
export * from "./registry";
export * from "./runtime";
export * from "./view";

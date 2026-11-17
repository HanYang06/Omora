/**
 * sdk 核心导出：`scope.ts`（Node / 生命周期）、`host.ts`（immediate host）、
 * `requests.ts`（请求、响应、稳定错误码）、`capabilities.ts`（父授窄端口）、
 * `page.ts` / `when.ts` / `bind.ts`（Page 层）。
 * 契约是 `schema/sdk/scope.json` 与 `schema/sdk/page.json`。
 */

export * from "./requests";
export * from "./capabilities";
export * from "./host";
export * from "./scope";
export * from "./when";
export * from "./bind";
export * from "./page";

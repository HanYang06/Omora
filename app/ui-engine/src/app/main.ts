import { Connection } from "./connection";
import { createLogger } from "./log";
import { DomApp } from "./app";
import { LiveSlotApp } from "./live";
import "../styles/styles.css";
import "../styles/media.css";

/** 入口模式：默认主会话 Slot；`?engine=legacy` 回退旧快照，`?engine=slot` 看内置 fixture 预览。 */
export type EngineMode = "legacy" | "preview" | "live";

/**
 * 解析入口模式（可单独测试）：
 * - `engine=legacy` → 旧快照渲染（回退开关，删 legacy 时一起消失）；
 * - `engine=slot` → 内置 Slot 文档预览（不连 Python）；
 * - 其它（含空查询、`engine=live`）→ 主会话 Slot 运行时（S6.4 起默认）。
 */
export function engineMode(search: string): EngineMode {
  const engine = new URLSearchParams(search).get("engine");
  if (engine === "legacy") {
    return "legacy";
  }
  if (engine === "slot") {
    return "preview";
  }
  return "live";
}

export function wantsPreview(search: string): boolean {
  return engineMode(search) === "preview";
}

export function wantsLive(search: string): boolean {
  return engineMode(search) === "live";
}

function startLegacy(container: HTMLElement): void {
  const connection = new Connection();
  const logger = createLogger({
    call: (target, method, args) => connection.call(target, method, args),
  });
  new DomApp(connection, logger).mount(container);
}

/** 主会话 Slot 入口：连接 Python，第一份视图建引擎，之后按视图更新。 */
function startLive(container: HTMLElement): void {
  const connection = new Connection();
  const logger = createLogger({
    call: (target, method, args) => connection.call(target, method, args),
  });
  new LiveSlotApp(connection, logger).mount(container);
}

/** Slot 运行时只在需要时拉：preview 是独立 chunk，不进主 chunk。 */
function startPreview(container: HTMLElement): void {
  void import("./preview")
    .then((preview) => {
      preview.mountPreview(container);
    })
    .catch((error: unknown) => {
      console.error("[omora] Slot 预览入口加载失败:", error);
    });
}

/**
 * 启动入口：默认走主会话 Slot 运行时（连 Python）；`?engine=slot` 看内置预览、
 * `?engine=legacy` 回退旧快照路径。
 *
 * 单独导出便于以后补入口级测试；HTML 加载本模块时 `#root` 一定在。
 */
export function bootstrap(container: HTMLElement, search: string): void {
  const mode = engineMode(search);
  if (mode === "preview") {
    startPreview(container);
    return;
  }
  if (mode === "legacy") {
    startLegacy(container);
    return;
  }
  startLive(container);
}

// 被测试 / 工具 import 时没有 #root，不能起副作用；真正入口（index.html）一定有。
const container = document.getElementById("root");
if (container !== null) {
  bootstrap(container, window.location.search);
}

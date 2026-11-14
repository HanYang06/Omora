import { Connection } from "./connection";
import { createLogger } from "./log";
import { LiveSlotApp } from "./live";
import "../styles/styles.css";
import "../styles/media.css";

/** 入口模式：默认主会话 Slot；`?engine=slot` 看内置 fixture 预览。 */
export type EngineMode = "preview" | "live";

/**
 * 解析入口模式（可单独测试）：
 * - `engine=slot` → 内置 Slot 文档预览（不连 Python，用打包进来的 fixture 视图）；
 * - 其它（含空查询）→ 主会话 Slot 运行时（连 Python，默认）。
 */
export function engineMode(search: string): EngineMode {
  return new URLSearchParams(search).get("engine") === "slot" ? "preview" : "live";
}

export function wantsPreview(search: string): boolean {
  return engineMode(search) === "preview";
}

export function wantsLive(search: string): boolean {
  return engineMode(search) === "live";
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
 * 启动入口：默认走主会话 Slot 运行时（连 Python）；`?engine=slot` 看内置预览。
 *
 * 单独导出便于入口级测试；HTML 加载本模块时 `#root` 一定在。
 */
export function bootstrap(container: HTMLElement, search: string): void {
  if (engineMode(search) === "preview") {
    startPreview(container);
    return;
  }
  startLive(container);
}

// 被测试 / 工具 import 时没有 #root，不能起副作用；真正入口（index.html）一定有。
const container = document.getElementById("root");
if (container !== null) {
  bootstrap(container, window.location.search);
}

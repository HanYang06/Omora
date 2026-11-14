import { Connection } from "./connection";
import { createLogger } from "./log";
import { DomApp } from "./app";
import { LiveSlotApp } from "./live";
import "../styles/styles.css";
import "../styles/media.css";

/**
 * `?engine=slot` → Slot 文档预览入口（S3-e）。
 *
 * 解析可单独测试：只有查询串里的 `engine` 恰好是 `slot` 才走预览；
 * 其它（含 `?engine=legacy`、空查询）继续走 legacy 主路径。
 */
export function wantsPreview(search: string): boolean {
  return new URLSearchParams(search).get("engine") === "slot";
}

/** `?engine=live` → 主会话 Slot 运行时（S6 迁移期入口；默认仍是 legacy）。 */
export function wantsLive(search: string): boolean {
  return new URLSearchParams(search).get("engine") === "live";
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
 * 启动入口：`?engine=slot` 走 Slot 预览（不建 Connection、不调 Python），
 * `?engine=live` 走主会话 Slot 运行时（连 Python），否则 legacy。
 *
 * 单独导出便于以后补入口级测试；HTML 加载本模块时 `#root` 一定在。
 */
export function bootstrap(container: HTMLElement, search: string): void {
  if (wantsPreview(search)) {
    startPreview(container);
    return;
  }
  if (wantsLive(search)) {
    startLive(container);
    return;
  }
  startLegacy(container);
}

// 被测试 / 工具 import 时没有 #root，不能起副作用；真正入口（index.html）一定有。
const container = document.getElementById("root");
if (container !== null) {
  bootstrap(container, window.location.search);
}

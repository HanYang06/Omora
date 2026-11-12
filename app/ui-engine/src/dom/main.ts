import { Connection } from "../core/connection";
import { createLogger } from "../core/log";
import { DomApp } from "./app";
import "../styles/styles.css";
import "../styles/media.css";

/**
 * `?engine=v2` → v2 预览入口（S3-e）。
 *
 * 解析可单独测试：只有查询串里的 `engine` 恰好是 `v2` 才走预览；
 * 其它（含 `?engine=v1`、空查询）继续走原来的 v1 主路径。
 */
export function wantsPreview(search: string): boolean {
  return new URLSearchParams(search).get("engine") === "v2";
}

function startV1(container: HTMLElement): void {
  const connection = new Connection();
  const logger = createLogger({
    call: (target, method, args) => connection.call(target, method, args),
  });
  new DomApp(connection, logger).mount(container);
}

/** v2 运行时只在需要时拉：preview 是独立 chunk，不进主 chunk。 */
function startPreview(container: HTMLElement): void {
  void import("./v2/preview")
    .then((preview) => {
      preview.mountPreview(container);
    })
    .catch((error: unknown) => {
      console.error("[omora] v2 预览入口加载失败:", error);
    });
}

/**
 * 启动入口：`?engine=v2` 走 v2 预览（不建 Connection、不调 Python），否则 v1。
 *
 * 单独导出便于以后补入口级测试；HTML 加载本模块时 `#root` 一定在。
 */
export function bootstrap(container: HTMLElement, search: string): void {
  if (wantsPreview(search)) {
    startPreview(container);
    return;
  }
  startV1(container);
}

// 被测试 / 工具 import 时没有 #root，不能起副作用；真正入口（index.html）一定有。
const container = document.getElementById("root");
if (container !== null) {
  bootstrap(container, window.location.search);
}

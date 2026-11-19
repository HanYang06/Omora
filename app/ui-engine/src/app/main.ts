import { Connection } from "./connection";
import { createLogger } from "./log";
import { TreeLiveApp } from "./tree/live";
import "../styles/styles.css";
import "../styles/media.css";

/** 入口模式：默认 V1 树主会话；`?engine=tree` / `tree-live` / `virtual` / `dialog` 是内置预览。 */
export type EngineMode = "tree" | "tree-live" | "virtual" | "dialog";

/**
 * 解析入口模式（可单独测试）：
 * - `engine=tree` → V1 构建产物预览（读 `/tree/`，挂 TreeRuntime）；
 * - `engine=virtual` / `engine=dialog` → 组件预览（不连 Python）；
 * - 其它（含空查询、`engine=tree-live`、未知值）→ V1 树主会话（连 Python）。
 */
export function engineMode(search: string): EngineMode {
  const engine = new URLSearchParams(search).get("engine");
  if (engine === "tree") {
    return "tree";
  }
  if (engine === "virtual") {
    return "virtual";
  }
  if (engine === "dialog") {
    return "dialog";
  }
  return "tree-live";
}

/** 主会话入口：只走 V1 树（连 Python，拉 ui.tree）；不再退回 Slot。 */
function startTreeLive(container: HTMLElement): void {
  const connection = new Connection();
  const logger = createLogger({
    call: (target, method, args) => connection.call(target, method, args),
  });
  new TreeLiveApp(connection, logger).mount(container);
}

/** 虚拟列表预览：1000 行，验证只挂窗口内的行。 */
function startVirtual(container: HTMLElement): void {
  void import("./virtual_preview")
    .then((preview) => {
      preview.mountVirtualPreview(container);
    })
    .catch((error: unknown) => {
      container.textContent = "虚拟列表预览加载失败：" + String(error);
      console.error("[omora] 虚拟列表预览加载失败:", error);
    });
}

/** 原生 dialog 预览：模态、Esc、焦点都由平台负责。 */
function startDialog(container: HTMLElement): void {
  void import("./dialog_preview")
    .then((preview) => {
      preview.mountDialogPreview(container);
    })
    .catch((error: unknown) => {
      container.textContent = "对话框预览加载失败：" + String(error);
      console.error("[omora] 对话框预览加载失败:", error);
    });
}

/** V1 产物预览也在独立 chunk：读 /tree/ 产物，失败直接把原因写在页面上。 */
function startTree(container: HTMLElement): void {
  void import("./tree/preview")
    .then((preview) => preview.mountTreePreview(container))
    .catch((error: unknown) => {
      const text = error instanceof Error ? error.message : String(error);
      container.textContent = "V1 预览加载失败：" + text;
      console.error("[omora] V1 预览加载失败:", error);
    });
}

/**
 * 启动入口：默认走 V1 树主会话（连 Python）；`?engine=tree` / `virtual` / `dialog`
 * 是内置预览，不连 Python。
 *
 * 单独导出便于入口级测试；HTML 加载本模块时 `#root` 一定在。
 */
export function bootstrap(container: HTMLElement, search: string): void {
  const mode = engineMode(search);
  if (mode === "tree") {
    startTree(container);
    return;
  }
  if (mode === "virtual") {
    startVirtual(container);
    return;
  }
  if (mode === "dialog") {
    startDialog(container);
    return;
  }
  startTreeLive(container);
}

// 被测试 / 工具 import 时没有 #root，不能起副作用；真正入口（index.html）一定有。
const container = document.getElementById("root");
if (container !== null) {
  bootstrap(container, window.location.search);
}

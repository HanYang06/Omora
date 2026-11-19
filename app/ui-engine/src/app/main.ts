import { Connection } from "./connection";
import { createLogger } from "./log";
import { LiveSlotApp } from "./live";
import "../styles/styles.css";
import "../styles/media.css";

/** 入口模式：默认主会话 Slot；`?engine=slot` / `tree` / `virtual` 是内置预览。 */
export type EngineMode = "preview" | "tree" | "virtual" | "dialog" | "live";

/**
 * 解析入口模式（可单独测试）：
 * - `engine=slot` → 内置 Slot 文档预览（不连 Python，用打包进来的 fixture 视图）；
 * - `engine=tree` → V1 构建产物预览（读 `/tree/`，挂 TreeRuntime）；
 * - 其它（含空查询）→ 主会话 Slot 运行时（连 Python，默认）。
 */
export function engineMode(search: string): EngineMode {
  const engine = new URLSearchParams(search).get("engine");
  if (engine === "slot") {
    return "preview";
  }
  if (engine === "tree") {
    return "tree";
  }
  if (engine === "virtual") {
    return "virtual";
  }
  if (engine === "dialog") {
    return "dialog";
  }
  return "live";
}

export function wantsTree(search: string): boolean {
  return engineMode(search) === "tree";
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
 * 启动入口：默认走主会话 Slot 运行时（连 Python）；`?engine=slot` / `?engine=tree`
 * 分别是内置 Slot 预览与 V1 产物预览。
 *
 * 单独导出便于入口级测试；HTML 加载本模块时 `#root` 一定在。
 */
export function bootstrap(container: HTMLElement, search: string): void {
  const mode = engineMode(search);
  if (mode === "preview") {
    startPreview(container);
    return;
  }
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
  startLive(container);
}

// 被测试 / 工具 import 时没有 #root，不能起副作用；真正入口（index.html）一定有。
const container = document.getElementById("root");
if (container !== null) {
  bootstrap(container, window.location.search);
}

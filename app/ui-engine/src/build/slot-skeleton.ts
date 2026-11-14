import { createSlotRenderer } from "../components/slot_registry";
import { link } from "../link/link";
import { WINDOW_SCAFFOLD } from "../link/scaffold";
import { parseView } from "../link/view";
import { slotToNode } from "../renderer/slot_bridge";
import type { RenderContext } from "../renderer/types";

/**
 * 构建期编译器（S6.5）：把一份主会话 view 编译成首帧 HTML。
 *
 * 和运行时共用同一套 view 校验（link/view 的 parseView）、同一个链接器（link）与同一张
 * Slot 注册表（components/slot_registry），所以编译出来的结构就是 JS 启动后画的结构；
 * 不复制一份静态模板，也不给 kind 加第二套实现。
 *
 * 调用方必须提供 DOM（浏览器、jsdom、未来的 SSR 宿主）：kind 直接写 DOM，不认字符串。
 * 编译只产出结构，不注册事件——HTML 里的按钮处于禁用态，等运行时挂上监听。
 */

/** 静态骨架不加载媒体：真数据到了才由运行时按需取。 */
function noMedia(): Promise<never> {
  return Promise.reject(new Error("静态骨架不加载媒体"));
}

/** 主会话 view → 首帧 HTML；view 或链接不合法直接抛（构建期不要静默空白）。 */
export function compileSlotSkeleton(view: unknown): string {
  const parsed = parseView(view);
  if (!parsed.ok) {
    throw new Error(
      "启动视图不合法：" +
        parsed.diagnostics.map((diagnostic) => diagnostic.code + " " + diagnostic.message).join("；"),
    );
  }
  const linked = link(WINDOW_SCAFFOLD, parsed.view.localTrees, {});
  if (!linked.ok) {
    throw new Error(
      "启动视图链接失败：" +
        linked.diagnostics.map((diagnostic) => diagnostic.code + " " + diagnostic.message).join("；"),
    );
  }
  const container = document.createElement("div");
  const context: RenderContext = {
    event: () => undefined,
    loadMedia: noMedia,
    cleanup: () => undefined,
  };
  const renderer = createSlotRenderer(context);
  try {
    renderer.render(slotToNode(linked.tree), container);
    return container.innerHTML;
  } finally {
    renderer.dispose();
  }
}

import type { ConnectionStatus } from "../core/connection";
import type { Snapshot } from "../core/types";
import { DomShell } from "../dom/shell";

/**
 * 构建期编译器：把一份快照编译成首帧 HTML。
 *
 * 和运行时共用同一套 kind 与 DomShell，所以编译出来的结构就是 JS 启动后画的结构；
 * 不复制一份"静态模板"，也不给 kind 加第二套实现。
 *
 * 调用方必须提供 DOM（浏览器、jsdom、未来的 SSR 宿主）：kind 直接写 DOM，不认字符串。
 * 编译只产出结构，不注册事件——HTML 里的按钮处于禁用态，等运行时挂上监听。
 */

export interface SkeletonOptions {
  /** 连接状态；首帧默认未连接。 */
  status?: ConnectionStatus;
  /** 连接端点；只用于状态提示的 title。 */
  endpoint?: string;
}

/** 静态骨架不加载媒体：真数据到了才由运行时按需取。 */
function noMedia(): Promise<never> {
  return Promise.reject(new Error("静态骨架不加载媒体"));
}

/**
 * 编译一份快照。返回值是容器内的 HTML，可直接注入 `<div id="root">`。
 *
 * 需要全局 `document` 已经存在；生命周期（创建/销毁）都收在这一次调用里。
 */
export function compileSkeleton(snapshot: Snapshot | null, options: SkeletonOptions = {}): string {
  const container = document.createElement("div");
  const shell = new DomShell(container, {
    onNavigate: () => undefined,
    onEvent: () => undefined,
    loadMedia: noMedia,
  });
  try {
    shell.render(snapshot, options.status ?? "idle", options.endpoint ?? "");
    return container.innerHTML;
  } finally {
    shell.dispose();
  }
}

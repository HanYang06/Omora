/**
 * 文档视图（S4）：把 EngineRuntime 接到 DOM renderer 上。
 *
 * 这是宿主使用 v2 运行时的最小胶水：建引擎（createSession + hydrate）→ 桥接根树 →
 * 现有 DomRenderer；引擎每次成功 apply 通过 onChange 通知视图按 id 重画（跨父 move
 * 由 renderer 复用元素）。视图不持有业务状态，也不改会话。
 */

import type { JsonObject } from "../../core/protocol";
import type { MediaData } from "../../core/types";
import { createEngine, type EngineRuntime, type EngineApplyResult } from "../../runtime/engine";
import type { Requester } from "../../runtime/permissions";
import type { Diagnostic } from "../../link/types";
import { slotToNode } from "./bridge";
import { createSlotRenderer } from "./registry";
import type { RenderContext } from "../types";

export interface DocumentViewOptions {
  /** 运行期变更主体；缺省 = 系统来源（全放行）。 */
  requester?: Requester;
  /** 节点事件出口（handler id + 载荷）；缺省丢弃。 */
  onEvent?: (handler: string, payload?: JsonObject) => void;
  /** 媒体取回；缺省拒绝。 */
  loadMedia?: (media: string) => Promise<MediaData>;
}

export type MountDocumentViewResult =
  { ok: true; view: DocumentView } | { ok: false; diagnostics: Diagnostic[] };

export class DocumentView {
  private readonly engineRuntime: EngineRuntime;
  private readonly renderer: ReturnType<typeof createSlotRenderer>;
  private readonly container: HTMLElement;
  private readonly unsubscribe: () => void;

  constructor(container: HTMLElement, engine: EngineRuntime, options: DocumentViewOptions = {}) {
    this.engineRuntime = engine;
    this.container = container;
    const context: RenderContext = {
      event: (handler, payload) => options.onEvent?.(handler, payload),
      loadMedia: (media) =>
        options.loadMedia === undefined
          ? Promise.reject(new Error("文档视图没有配置 loadMedia"))
          : options.loadMedia(media),
      cleanup: () => undefined,
    };
    this.renderer = createSlotRenderer(context);
    container.replaceChildren();
    this.renderAll();
    this.unsubscribe = engine.onChange(() => {
      this.renderAll();
    });
  }

  /** 当前引擎（宿主用它提交 ops / 数据 / 全量，视图会自动重画）。 */
  get engine(): EngineRuntime {
    return this.engineRuntime;
  }

  /** 立即按当前会话重画；一般由引擎通知触发，调试时也可手动调。 */
  render(): void {
    this.renderAll();
  }

  /** 卸载：取消监听 → 渲染器清理 → 引擎账本收口；幂等。 */
  dispose(): { disposed: number; errors: unknown[] } {
    this.unsubscribe();
    this.renderer.dispose();
    this.container.replaceChildren();
    return this.engineRuntime.dispose();
  }

  /** 便捷：提交一条数据更新，返回引擎结果（成功时视图已经通过通知重画）。 */
  applyData(payload: unknown): EngineApplyResult {
    return this.engineRuntime.applyData(payload);
  }

  private renderAll(): void {
    this.renderer.render(slotToNode(this.engineRuntime.session.document.root), this.container);
    this.engineRuntime.noteRender();
  }
}

/** 从整份 v2 文档建引擎 + 视图；文档不合法返回诊断、不建视图。 */
export function mountDocumentView(
  container: HTMLElement,
  document: unknown,
  options: DocumentViewOptions = {},
): MountDocumentViewResult {
  const created = createEngine(document, {
    ...(options.requester === undefined ? {} : { requester: options.requester }),
  });
  if (!created.ok) {
    return created;
  }
  return { ok: true, view: new DocumentView(container, created.engine, options) };
}

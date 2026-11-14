/**
 * `?engine=live`：主会话 Slot 运行时入口（S6 迁移期；默认仍是 legacy）。
 *
 * 连接 → `ui.render {engine:"slot"}` → view payload → `createEngineFromView` → DocumentView；
 * 交互经渲染层 `ctx.event` 回传 handler id → `ui.event {engine:"slot"}` → 新 view →
 * `SourceEngine.applyView` → 引擎通知视图按 id 重画。异步推送 `ui.snapshot` 若带 view
 * 同样走 applyView。
 *
 * 迁移期约定：`engine:"slot"` 参数只用来让 Python 端切产出模式；legacy 入口不带这个参数，
 * 两条路径互不影响。默认入口切到 Slot 后（S6.3）这个标记和 legacy 路径一起删除。
 */

import type { ConnectionStatus, JsonObject, MediaData } from "../contract/protocol";
import type { Connection } from "./connection";
import type { Logger } from "./log";
import { reportDevicesOnce } from "./device_report";
import { fetchMedia } from "../platform/media";
import { createEngineFromView, type SourceEngine } from "../host/engine_sources";
import { DocumentView } from "./view";

const SNAPSHOT_TOPIC = "ui.snapshot";

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 只认 `view` payload；legacy 快照（没有 kind 或别的 kind）一律忽略。 */
function isViewPayload(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  return (value as Record<string, unknown>).kind === "view";
}

/** 主会话 Slot 运行时的宿主壳：连接、视图、事件与推送都在这里收口。 */
export class LiveSlotApp {
  private container: HTMLElement | null = null;
  private view: DocumentView<SourceEngine> | null = null;
  private status: ConnectionStatus = "idle";
  private replayed = false;
  private readonly logs: Record<"conn" | "render" | "event" | "media", Logger>;

  constructor(
    private readonly connection: Connection,
    logger: Logger,
  ) {
    this.logs = {
      conn: logger.child("conn"),
      render: logger.child("render"),
      event: logger.child("event"),
      media: logger.child("media"),
    };
  }

  /** 挂到容器：清掉构建期静态骨架，订阅状态 / 推送，然后连接。 */
  mount(container: HTMLElement): void {
    this.container = container;
    container.replaceChildren();
    this.connection.subscribeStatus((status) => this.onStatus(status));
    this.connection.onEvent(SNAPSHOT_TOPIC, (payload) => this.onSnapshot(payload));
    this.connection.connect();
  }

  /** 卸载视图（引擎账本一并收口）；不关连接，连接由入口自己管。 */
  dispose(): void {
    this.view?.dispose();
    this.view = null;
    this.container = null;
  }

  private containerOf(): HTMLElement {
    if (this.container === null) {
      throw new Error("LiveSlotApp 还没 mount");
    }
    return this.container;
  }

  private onStatus(status: ConnectionStatus): void {
    if (this.status !== status) {
      if (status === "open") {
        this.logs.conn.info("conn.open", { endpoint: this.connection.endpoint });
      } else if (status === "failed") {
        this.logs.conn.error("conn.failed", { endpoint: this.connection.endpoint });
      } else {
        this.logs.conn.info("conn." + status, { endpoint: this.connection.endpoint });
      }
    }
    this.status = status;
    if (status !== "open") {
      this.replayed = false;
      return;
    }
    if (!this.replayed) {
      void this.replay();
    }
  }

  /** 重连 / 首次连上：报能力 → 订阅推送 → 拉第一份视图。 */
  private async replay(): Promise<void> {
    this.replayed = true;
    try {
      await reportDevicesOnce(this.connection);
    } catch (error) {
      this.logs.conn.warning("capability.report_failed", { err: errorText(error) });
    }
    try {
      await this.connection.subscribe([SNAPSHOT_TOPIC]);
    } catch (error) {
      this.logs.conn.warning("subscribe.failed", { err: errorText(error) });
    }
    await this.requestView();
  }

  private async requestView(): Promise<void> {
    try {
      const payload = await this.connection.call("ui", "render", { engine: "slot" });
      this.applyView(payload);
    } catch (error) {
      this.logs.render.error("view.render_failed", { err: errorText(error) });
    }
  }

  /** 第一份视图建引擎 + 视图；之后按全量替换更新同一引擎。 */
  private applyView(payload: unknown): void {
    if (!isViewPayload(payload)) {
      this.logs.render.warning("view.bad_payload", { kind: "not-a-view" });
      return;
    }
    if (this.view === null) {
      const created = createEngineFromView(payload);
      if (!created.ok) {
        this.logs.render.error("view.create_failed", {
          codes: created.diagnostics.map((diagnostic) => diagnostic.code).join(","),
        });
        return;
      }
      this.view = new DocumentView(this.containerOf(), created.engine, {
        onEvent: (handler, eventPayload) => this.sendEvent(handler, eventPayload),
        loadMedia: (media) => this.loadMedia(media),
      });
      this.logs.render.info("view.mounted", {
        version: created.engine.session.document.version,
      });
      return;
    }
    const applied = this.view.engine.applyView(payload);
    if (!applied.ok) {
      this.logs.render.error("view.apply_failed", {
        codes: applied.diagnostics.map((diagnostic) => diagnostic.code).join(","),
      });
      return;
    }
    this.logs.render.info("view.applied", {
      version: applied.session.document.version,
      changed: applied.changed.length,
    });
  }

  /** 渲染层事件 → Python；结果预期是新视图（切页 / 更新都在里面）。 */
  private sendEvent(handler: string, payload?: JsonObject): void {
    this.logs.event.debug("event.sent", { handler });
    void this.connection
      .call("ui", "event", { handler, payload: payload ?? {}, engine: "slot" })
      .then((value) => this.applyView(value))
      .catch((error: unknown) => {
        this.logs.event.error("event.failed", { handler, err: errorText(error) });
      });
  }

  private onSnapshot(payload: unknown): void {
    this.applyView(payload);
  }

  private loadMedia(media: string): Promise<MediaData> {
    return fetchMedia(
      (target, method, args) => this.connection.call(target, method, args),
      media,
    ).catch((error: unknown) => {
      this.logs.media.error("media.failed", { media, err: errorText(error) });
      throw error;
    });
  }
}

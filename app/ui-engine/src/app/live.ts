/**
 * 主会话 Slot 运行时入口（默认入口）。
 *
 * 连接 → `ui.render` → view payload → `createEngineFromView` → DocumentView；交互经渲染层
 * `ctx.event` 回传 handler id → `ui.event` → 新 view → `SourceEngine.applyView` → 引擎通知
 * 视图按 id 重画。异步推送 `ui.snapshot` 若带 view 同样走 applyView。
 *
 * `?engine=slot` 的内置 fixture 预览也复用同一套引擎/视图，只是不连 Python（app/preview.ts）。
 */

import type { ConnectionStatus, JsonObject, MediaData } from "../contract/protocol";
import type { Connection } from "./connection";
import type { Logger } from "./log";
import { reportDevicesOnce } from "./device_report";
import { fetchMedia } from "../platform/media";
import { createEngineFromView, type SourceEngine } from "../host/engine_sources";
import { parseSourcePush } from "../link/parse";
import type { LocalTree } from "../link/types";
import { DocumentView } from "./view";
import {
  mountRuntimeSources,
  runtimeSources,
  type RuntimeMount,
  type RuntimeSource,
} from "./runtime_sources";

const SNAPSHOT_TOPIC = "ui.snapshot";

/** 连接状态文案：状态点单独浮在左下角（与读屏 aria-label 同源）。 */
const STATUS_TEXT: Record<ConnectionStatus, string> = {
  idle: "未连接",
  connecting: "连接中…",
  open: "已连接",
  closed: "连接已断开",
  failed: "连接失败",
};

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 只认 `view` payload；没有 kind 或别的 kind 一律忽略。 */
function isViewPayload(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  return (value as Record<string, unknown>).kind === "view";
}

/** 主会话 Slot 运行时的宿主壳：连接、视图、事件、运行后来源与推送都在这里收口。 */
export interface LiveSlotOptions {
  /** 运行后来源；缺省自动发现 src/app/runtime_sources/。测试传空数组关掉时钟。 */
  sources?: readonly RuntimeSource[];
}
export class LiveSlotApp {
  private container: HTMLElement | null = null;
  private host: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private statusLabel: HTMLElement | null = null;
  private view: DocumentView<SourceEngine> | null = null;
  private runtime: RuntimeMount | null = null;
  /** 网络推来的运行后来源 owner：applyView 时要一起保留。 */
  private readonly pushedOwners = new Set<string>();
  private status: ConnectionStatus = "idle";
  private replayed = false;
  private readonly logs: Record<"conn" | "render" | "event" | "media", Logger>;

  constructor(
    private readonly connection: Connection,
    logger: Logger,
    private readonly options: LiveSlotOptions = {},
  ) {
    this.logs = {
      conn: logger.child("conn"),
      render: logger.child("render"),
      event: logger.child("event"),
      media: logger.child("media"),
    };
  }

  /**
   * 挂到容器：清掉构建期静态骨架 → 铺两层（左下角连接状态 + 视图宿主）→ 订阅 → 连接。
   * 视图宿主单独一层，渲染器替换子节点时不会把状态点一起清掉。
   */
  mount(container: HTMLElement): void {
    this.container = container;
    container.replaceChildren();
    this.mountStatus(container);
    this.host = document.createElement("div");
    this.host.className = "dendro-live-host";
    container.append(this.host);
    this.paintStatus("idle");
    this.connection.subscribeStatus((status) => this.onStatus(status));
    this.connection.onEvent(SNAPSHOT_TOPIC, (payload) => this.onSnapshot(payload));
    this.connection.connect();
  }

  /** 卸载视图与运行后来源（引擎账本一并收口）；不关连接，连接由入口自己管。 */
  dispose(): void {
    this.runtime?.dispose();
    this.runtime = null;
    this.pushedOwners.clear();
    this.view?.dispose();
    this.view = null;
    this.container?.replaceChildren();
    this.container = null;
    this.host = null;
    this.statusEl = null;
    this.statusLabel = null;
  }

  private mountStatus(container: HTMLElement): void {
    const status = document.createElement("div");
    status.className = "omora-conn dendro-live-status";
    status.setAttribute("role", "status");
    const dot = document.createElement("span");
    dot.className = "omora-conn-dot";
    dot.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    label.className = "omora-conn-label";
    status.append(dot, label);
    container.append(status);
    this.statusEl = status;
    this.statusLabel = label;
  }

  /** 状态点 / 读屏文字与 legacy 壳一致；endpoint 进 title，悬停能看到连的哪儿。 */
  private paintStatus(status: ConnectionStatus): void {
    if (this.statusEl === null || this.statusLabel === null) {
      return;
    }
    this.statusEl.dataset.status = status;
    this.statusEl.setAttribute("aria-label", STATUS_TEXT[status]);
    this.statusEl.title = this.connection.endpoint;
    this.statusLabel.textContent = STATUS_TEXT[status];
  }

  private hostOf(): HTMLElement {
    if (this.host === null) {
      throw new Error("LiveSlotApp 还没 mount");
    }
    return this.host;
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
    this.paintStatus(status);
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
      const payload = await this.connection.call("ui", "render", {});
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
      this.view = new DocumentView(this.hostOf(), created.engine, {
        onEvent: (handler, eventPayload) => this.sendEvent(handler, eventPayload),
        loadMedia: (media) => this.loadMedia(media),
      });
      this.runtime = mountRuntimeSources(
        created.engine,
        this.options.sources ?? runtimeSources(),
        this.logs.render,
      );
      this.logs.render.info("view.mounted", {
        version: created.engine.session.document.version,
      });
      return;
    }
    // 运行后来源会推进文档版本；主视图是权威全量，按引擎当前版本 +1 应用，
    // 不被来源热更新卡住（view.version 只用于 Python 侧的产出顺序）。
    const current = this.view.engine.session.document.version;
    const record = payload as Record<string, unknown>;
    const rawVersion = record.version;
    const version = typeof rawVersion === "number" ? rawVersion : 0;
    const versioned: Record<string, unknown> =
      version > current ? record : { ...record, version: current + 1 };
    const applied = this.view.engine.applyView(versioned, {
      keepOwners: this.keepOwners(),
    });
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
      .call("ui", "event", { handler, payload: payload ?? {} })
      .then((value) => this.applyView(value))
      .catch((error: unknown) => {
        this.logs.event.error("event.failed", { handler, err: errorText(error) });
      });
  }

  private onSnapshot(payload: unknown): void {
    if (
      typeof payload === "object" &&
      payload !== null &&
      !Array.isArray(payload) &&
      (payload as Record<string, unknown>).kind === "source"
    ) {
      this.applySource(payload);
      return;
    }
    this.applyView(payload);
  }

  /** 运行后来源的保留名单：宿主挂的 + 网络推来的。 */
  private keepOwners(): string[] {
    const mounted = this.runtime?.owners() ?? [];
    return [...mounted, ...this.pushedOwners];
  }

  /** 网络推来的来源：按 owner 整组替换，removed 撤来源（级联撤树）。 */
  private applySource(payload: unknown): void {
    if (this.view === null) {
      this.logs.render.warning("source.before_view", {});
      return;
    }
    const parsed = parseSourcePush(payload);
    if (!parsed.ok) {
      this.logs.render.error("source.bad_payload", {
        codes: parsed.diagnostics.map((diagnostic) => diagnostic.code).join(","),
      });
      return;
    }
    for (const owner of parsed.push.removed) {
      const result = this.view.engine.removeSource(owner);
      if (!result.ok) {
        this.logs.render.error("source.remove_failed", { owner });
        continue;
      }
      this.pushedOwners.delete(owner);
    }
    const byOwner = new Map<string, LocalTree[]>();
    for (const tree of parsed.push.trees) {
      const trees = byOwner.get(tree.owner) ?? [];
      trees.push(tree);
      byOwner.set(tree.owner, trees);
    }
    for (const [owner, trees] of byOwner) {
      const result = this.view.engine.registerSource(owner, trees);
      if (!result.ok) {
        this.logs.render.error("source.register_failed", { owner });
        continue;
      }
      this.pushedOwners.add(owner);
    }
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

import type { Connection, ConnectionStatus } from "../core/connection";
import { reportDevicesOnce } from "../core/device-report";
import type { Logger } from "../core/log";
import type { JsonObject } from "../core/protocol";
import { topicsToSync } from "../core/topics";
import type { MediaData, PageEntry, Snapshot } from "../core/types";
import { fetchMedia } from "../media/media";
import { initialSnapshot, isStale } from "../render/boot";
import { applySnapshotUpdate, isSnapshot } from "../render/patch";
import { withContributions } from "../render/view";
import { DomShell, type ShellOptions } from "./shell";

const SNAPSHOT_TOPIC = "ui.snapshot";

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 无框架的会话容器：连接、订阅、快照、事件，全部推给 DomShell。 */
export class DomApp {
  private snapshot: Snapshot | null;
  private status: ConnectionStatus = "idle";
  private lastStatus: ConnectionStatus | null = null;
  private page: string | null = null;
  private renderSeq = 0;
  private replayed = false;
  private replaySeq = 0;
  private subscribed: string[] = [];
  private readonly bootPages: PageEntry[] | null;
  private readonly logs: Record<"conn" | "render" | "event" | "media", Logger>;
  private shell: DomShell | null = null;

  constructor(
    private readonly connection: Connection,
    logger: Logger,
  ) {
    this.snapshot = initialSnapshot();
    this.bootPages = this.snapshot?.pages ?? null;
    this.logs = {
      conn: logger.child("conn"),
      render: logger.child("render"),
      event: logger.child("event"),
      media: logger.child("media"),
    };
  }

  mount(container: HTMLElement): void {
    // Vite 构建期把启动骨架编译进了 #root，只负责 JS 起来前的首帧；
    // 运行时挂载时先清掉，避免两份壳叠在一起（同一份快照随后会重建一次）。
    container.replaceChildren();
    const options: ShellOptions = {
      onNavigate: (page) => {
        this.page = page;
        void this.requestRender(page);
      },
      onEvent: (handler, payload) => this.sendEvent(handler, payload),
      loadMedia: (media) => this.loadMedia(media),
    };
    this.shell = new DomShell(container, options);
    this.paint();
    this.connection.subscribeStatus((status) => this.onStatus(status));
    this.connection.onEvent(SNAPSHOT_TOPIC, (payload) => this.onSnapshot(payload));
    this.connection.connect();
  }

  private paint(): void {
    const view = withContributions(this.snapshot);
    this.shell?.render(view, this.status, this.connection.endpoint);
  }

  private onStatus(status: ConnectionStatus): void {
    const previous = this.lastStatus;
    this.lastStatus = status;
    if (previous !== status) {
      if (status === "open") {
        this.logs.conn.info("conn.open", { endpoint: this.connection.endpoint });
      } else if (status === "closed") {
        this.logs.conn.info("conn.closed", { endpoint: this.connection.endpoint });
      } else if (status === "failed") {
        this.logs.conn.error("conn.failed", { endpoint: this.connection.endpoint });
      }
    }
    this.status = status;
    if (status !== "open") {
      this.replayed = false;
      this.subscribed = [];
    }
    this.paint();
    if (status === "open" && !this.replayed) {
      void this.replay();
    }
  }

  private async replay(): Promise<void> {
    this.replayed = true;
    const generation = this.replaySeq + 1;
    this.replaySeq = generation;
    try {
      await reportDevicesOnce(this.connection);
    } catch (error) {
      this.logs.conn.warning("capability.report_failed", { err: errorText(error) });
    }
    if (generation !== this.replaySeq) {
      return;
    }
    try {
      const result = await this.connection.subscribe([SNAPSHOT_TOPIC]);
      this.subscribed = result.topics;
    } catch (error) {
      this.logs.conn.warning("subscribe.failed", { err: errorText(error) });
    }
    if (generation !== this.replaySeq) {
      return;
    }
    await this.requestRender(this.page);
  }

  private async syncTopics(next: Snapshot): Promise<void> {
    const { add, remove } = topicsToSync(this.subscribed, next.topics ?? [SNAPSHOT_TOPIC]);
    if (add.length === 0 && remove.length === 0) {
      return;
    }
    try {
      if (remove.length > 0) {
        const result = await this.connection.unsubscribe(remove);
        this.subscribed = result.topics;
      }
      if (add.length > 0) {
        const result = await this.connection.subscribe(add);
        this.subscribed = result.topics;
      }
    } catch (error) {
      this.logs.conn.warning("subscribe.failed", { err: errorText(error) });
    }
  }

  private apply(next: Snapshot): void {
    this.snapshot = next;
    void this.syncTopics(next);
    this.paint();
  }

  private async requestRender(page: string | null): Promise<void> {
    const seq = this.renderSeq + 1;
    this.renderSeq = seq;
    try {
      const value = await this.connection.call("ui", "render", page === null ? {} : { page });
      if (seq !== this.renderSeq) {
        return;
      }
      if (!isSnapshot(value)) {
        console.error("[omora] ui 返回的不是页面快照:", value);
        return;
      }
      if (this.snapshot === null) {
        const booted = this.bootPages;
        if (booted !== null && isStale(booted, value.pages)) {
          this.logs.render.warning("static.stale", {
            pages: value.pages.map((entry) => entry.name).join(","),
          });
        }
      }
      this.page = value.page;
      this.apply(value);
    } catch (error) {
      console.error("[omora] 调用失败:", error);
    }
  }

  private onSnapshot(payload: unknown): void {
    const current = this.snapshot;
    if (current === null) {
      void this.requestRender(this.page);
      return;
    }
    const update = applySnapshotUpdate(current, payload);
    if (update.ok) {
      this.apply(update.snapshot);
      return;
    }
    if (update.reason !== "page") {
      void this.requestRender(this.page);
    }
  }

  private sendEvent(handler: string, payload?: JsonObject): void {
    this.logs.event.debug("event.sent", { handler, keys: Object.keys(payload ?? {}).join(",") });
    void this.connection
      .call("ui", "event", { handler, payload: payload ?? {} })
      .catch((error: unknown) => {
        console.error("[omora] 调用失败:", error);
      });
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

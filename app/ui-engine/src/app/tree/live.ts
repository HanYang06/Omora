/**
 * 运行期 V1 树：调 `ui.tree` 拿 base + 局部树，链接期 compose 后挂到 DOM。
 *
 * 事件走 `ui.tree_event`：派发后拿一份新树，整棵 replace（ops 回包下一步）。
 * 事件串行执行，失败保留旧树并记日志；replace 前后保留焦点与滚动位置。
 */

import type { ConnectionStatus, JsonObject } from "../../contract/protocol";
import type { TreeRuntime } from "../../engine/tree/runtime";
import { composeTree } from "../../link/tree_compose";
import { fetchMedia } from "../../platform/media";
import type { RenderContext } from "../../renderer/types";
import { CallError } from "../connection";
import type { Logger } from "../log";
import { mountTreeDocument } from "./tree_renderer";

/** 树主会话只需要连接的三件事；`Connection` 结构上满足它，测试可以打桩。 */
export interface TreeConnection {
  call(target: string, method: string, args: JsonObject): Promise<unknown>;
  subscribeStatus(listener: (status: ConnectionStatus) => void): void;
  connect(): void;
}

/** 树主会话的宿主钩子：首帧前的一次性准备。 */
export interface TreeLiveOptions {
  /** 首次拉树前跑一次（例如上报客户端设备），失败只记日志。 */
  readonly prepare?: () => Promise<void>;
}

/** `ui.tree` 的线上形状：一页的 base + 局部树，和构建期 `build_page` 同形。 */
export interface TreeBuildPayload {
  readonly kind: "tree";
  readonly base: unknown;
  readonly partials: readonly unknown[];
}

export function isTreeBuild(value: unknown): value is TreeBuildPayload {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return record.kind === "tree" && record.base !== undefined && Array.isArray(record.partials);
}

/** `ui.tree_event` 的 ops 回包：只带差异，客户端在已挂树上打补丁。 */
export interface TreeOpsPayload {
  readonly kind: "ops";
  readonly document: number;
  readonly base: number;
  readonly seq: number;
  readonly ops: readonly unknown[];
}

export function isTreeOps(value: unknown): value is TreeOpsPayload {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return record.kind === "ops" && Array.isArray(record.ops);
}

/** 组合并挂载；组合失败直接抛，带诊断，不留半棵树。 */
export function mountTreeBuild(
  container: HTMLElement,
  payload: TreeBuildPayload,
  context: RenderContext,
): TreeRuntime {
  const composed = composeTree(payload.base, payload.partials);
  if (!composed.ok) {
    throw new Error("V1 树组合失败: " + JSON.stringify(composed.diagnostics));
  }
  return mountTreeDocument(container, composed.document, context);
}

/** 主会话的 V1 树入口：连上后拉当前页的构建输入，挂在独立宿主层里。 */
export class TreeLiveApp {
  private runtime: TreeRuntime | null = null;
  private host: HTMLElement | null = null;
  private container: HTMLElement | null = null;
  private loading = false;
  private prepared = false;
  private queue: Promise<void> = Promise.resolve();
  private readonly log: Logger;
  private readonly options: TreeLiveOptions;

  constructor(
    private readonly connection: TreeConnection,
    logger: Logger,
    options: TreeLiveOptions = {},
  ) {
    this.log = logger.child("tree");
    this.options = options;
  }

  mount(container: HTMLElement): void {
    this.container = container;
    container.replaceChildren();
    const host = document.createElement("div");
    host.className = "dendro-tree-live-host";
    container.append(host);
    this.host = host;
    this.connection.subscribeStatus((status) => {
      if (status === "open") {
        void this.load();
      }
    });
    this.connection.connect();
  }

  dispose(): void {
    this.runtime?.dispose();
    this.runtime = null;
    this.container?.replaceChildren();
    this.container = null;
    this.host = null;
  }

  private async load(): Promise<void> {
    if (this.loading || this.host === null) {
      return;
    }
    this.loading = true;
    const host = this.host;
    try {
      if (!this.prepared) {
        this.prepared = true;
        try {
          await this.options.prepare?.();
        } catch (error) {
          const text = error instanceof Error ? error.message : String(error);
          this.log.error("tree.prepare.failed", { err: text });
        }
      }
      const payload = await this.connection.call("ui", "tree", {});
      if (!isTreeBuild(payload)) {
        throw new Error("ui.tree 返回的不是树构建输入");
      }
      this.show(payload);
    } catch (error) {
      if (error instanceof CallError && error.code === "unknown_method") {
        this.log.error("tree.unavailable", { method: "ui.tree" });
        host.textContent = "V1 树不可用：Python 端没有 ui.tree";
        return;
      }
      const text = error instanceof Error ? error.message : String(error);
      this.log.error("tree.load.failed", { err: text });
      host.textContent = "V1 树加载失败：" + text;
    } finally {
      this.loading = false;
    }
  }

  /** 新树挂进新宿主，成功后再换掉旧树；失败时旧树还在。 */
  private show(payload: TreeBuildPayload): void {
    if (this.container === null) {
      return;
    }
    const focusId = this.activeNodeId();
    const scrolls = this.captureScroll();
    const host = document.createElement("div");
    host.className = "dendro-tree-live-host";
    const runtime = mountTreeBuild(host, payload, this.context());
    this.container.replaceChildren(host);
    this.runtime?.dispose();
    this.runtime = runtime;
    this.host = host;
    this.restoreFocus(host, focusId);
    this.restoreScroll(host, scrolls);
  }

  /** 当前焦点所在的树节点 id；焦点不在树里就是 undefined。 */
  private activeNodeId(): string | undefined {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || this.host === null || !this.host.contains(active)) {
      return undefined;
    }
    return active.dataset.nodeId;
  }

  private captureScroll(): Array<{ id: string; top: number }> {
    if (this.host === null) {
      return [];
    }
    const found: Array<{ id: string; top: number }> = [];
    for (const element of this.host.querySelectorAll<HTMLElement>("[data-node-id]")) {
      const id = element.dataset.nodeId;
      if (id !== undefined && element.scrollTop > 0) {
        found.push({ id, top: element.scrollTop });
      }
    }
    return found;
  }

  private restoreFocus(host: HTMLElement, id: string | undefined): void {
    if (id === undefined) {
      return;
    }
    const target = [...host.querySelectorAll<HTMLElement>("[data-node-id]")].find(
      (element) => element.dataset.nodeId === id,
    );
    target?.focus();
  }

  private restoreScroll(
    host: HTMLElement,
    scrolls: ReadonlyArray<{ id: string; top: number }>,
  ): void {
    for (const { id, top } of scrolls) {
      const target = [...host.querySelectorAll<HTMLElement>("[data-node-id]")].find(
        (element) => element.dataset.nodeId === id,
      );
      if (target !== undefined) {
        target.scrollTop = top;
      }
    }
  }

  private dispatch(handler: string, payload?: JsonObject): void {
    this.queue = this.queue
      .then(() => this.applyEvent(handler, payload))
      .catch((error: unknown) => {
        const text = error instanceof Error ? error.message : String(error);
        this.log.error("tree.event.failed", { handler, err: text });
      });
  }

  private async applyEvent(handler: string, payload?: JsonObject): Promise<void> {
    const next = await this.connection.call("ui", "tree_event", {
      handler,
      payload: payload ?? {},
    });
    if (isTreeOps(next)) {
      if (this.runtime === null) {
        throw new Error("树还没挂载，不能应用 ops");
      }
      const applied = this.runtime.applyOps(next);
      if (!applied.ok) {
        throw new Error("ops 应用失败: " + JSON.stringify(applied.diagnostics));
      }
      return;
    }
    if (!isTreeBuild(next)) {
      throw new Error("ui.tree_event 返回的既不是 ops，也不是树构建输入");
    }
    this.show(next);
  }

  private context(): RenderContext {
    return {
      event: (handler: string, payload?: JsonObject) => {
        this.dispatch(handler, payload);
      },
      loadMedia: (media: string) =>
        fetchMedia((target, method, args) => this.connection.call(target, method, args), media),
      cleanup: () => undefined,
    };
  }
}

/**
 * 运行期 V1 树：调 `ui.tree` 拿 base + 局部树，链接期 compose 后挂到 DOM。
 *
 * 当前是只读桥：事件还没有回源协议，`event` 只记日志。等 `on` handler id +
 * dispatch + ops 接上，这里再换成真正的派发。
 */

import type { JsonObject } from "../../contract/protocol";
import type { TreeRuntime } from "../../engine/tree/runtime";
import { composeTree } from "../../link/tree_compose";
import { fetchMedia } from "../../platform/media";
import type { RenderContext } from "../../renderer/types";
import type { Connection } from "../connection";
import type { Logger } from "../log";
import { mountTreeDocument } from "./tree_renderer";

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
  private readonly log: Logger;

  constructor(
    private readonly connection: Connection,
    logger: Logger,
  ) {
    this.log = logger.child("tree");
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
      const payload = await this.connection.call("ui", "tree", {});
      if (!isTreeBuild(payload)) {
        throw new Error("ui.tree 返回的不是树构建输入");
      }
      const next = mountTreeBuild(host, payload, this.context());
      this.runtime?.dispose();
      this.runtime = next;
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      this.log.error("tree.load.failed", { err: text });
      host.textContent = "V1 树加载失败：" + text;
    } finally {
      this.loading = false;
    }
  }

  private context(): RenderContext {
    return {
      event: (handler: string, payload?: JsonObject) => {
        this.log.info("tree.event.unhandled", { handler, payload });
      },
      loadMedia: (media: string) =>
        fetchMedia((target, method, args) => this.connection.call(target, method, args), media),
      cleanup: () => undefined,
    };
  }
}

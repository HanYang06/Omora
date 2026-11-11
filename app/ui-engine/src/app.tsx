import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { reportDevicesOnce } from "./core/device-report";
import { Connection, type ConnectionStatus } from "./core/connection";
import type { Logger } from "./core/log";
import { fetchMedia } from "./media/media";
import type { JsonObject } from "./core/protocol";
import { applySnapshotUpdate, isSnapshot } from "./render/patch";
import { initialSnapshot, isStale } from "./render/boot";
import { withContributions } from "./render/view";
import { topicsToSync } from "./core/topics";
import { Shell } from "./shell/shell";
import type { Node, PageEntry, Snapshot } from "./core/types";

/** 视图变化的唯一推送 topic：payload 里 content 是全量、ops 是补丁。 */
const SNAPSHOT_TOPIC = "ui.snapshot";

export interface AppProps {
  connection: Connection;
  logger: Logger;
}

/** 快照里有多少个节点：只数，不看内容。 */
function countNodes(node: Node): number {
  const children = Array.isArray(node.children) ? node.children : [];
  let total = 1;
  for (const child of children) {
    total += countNodes(child);
  }
  return total;
}

function elapsedMs(started: number): number {
  return Math.round((performance.now() - started) * 10) / 10;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 默认母页面的容器：持有快照与连接状态。
 * 每次 open（含重连）都重放：上报能力 → 订阅 ui.snapshot → render 当前页。
 * 视图变化只走 ui.snapshot 事件；用户导航才决定当前页。
 */
export function App({ connection, logger }: AppProps): ReactNode {
  // 先画构建期冻结的骨架，不等后端；连上之后第一份真快照把它换掉。
  const [snapshot, setSnapshot] = useState<Snapshot | null>(() => initialSnapshot());
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const snapshotRef = useRef<Snapshot | null>(null);
  /** 用户想看的页；推送不能改它。 */
  const pageRef = useRef<string | null>(null);
  /** render 的请求序号：只认最新一次，先发后到的响应不能把页改回去。 */
  const renderSeq = useRef(0);
  /** 这一条连接上是否已经重放过；断线时复位，重连后重放。 */
  const replayed = useRef(false);
  /** open 的代号：断线 / 重连之后，旧的那次重放不再往下走。 */
  const replaySeq = useRef(0);
  const lastStatus = useRef<ConnectionStatus | null>(null);
  /** 启动骨架的导航；第一次拿到真快照时比对一次。 */
  const bootPages = useRef<PageEntry[] | null>(snapshot?.pages ?? null);
  /** 这条连接上已经订了哪些 topic：快照声明变了就补订 / 退订。 */
  const subscribed = useRef<string[]>([]);

  const logs = useMemo(
    () => ({
      conn: logger.child("conn"),
      render: logger.child("render"),
      event: logger.child("event"),
      media: logger.child("media"),
    }),
    [logger],
  );

  /** 按快照声明的 topic 补订 / 退订；引擎不写死插件 topic。 */
  const syncTopics = useCallback(
    async (next: Snapshot) => {
      const { add, remove } = topicsToSync(subscribed.current, next.topics ?? [SNAPSHOT_TOPIC]);
      if (add.length === 0 && remove.length === 0) {
        return;
      }
      try {
        if (remove.length > 0) {
          const result = await connection.unsubscribe(remove);
          subscribed.current = result.topics;
        }
        if (add.length > 0) {
          const result = await connection.subscribe(add);
          subscribed.current = result.topics;
        }
      } catch (error) {
        logs.conn.warning("subscribe.failed", { err: errorText(error) });
      }
    },
    [connection, logs],
  );

  // 只换视图，不改"用户想看的页"：当前页由导航和 render 的结果决定，推送不能切页。
  const applySnapshot = useCallback(
    (next: Snapshot) => {
      snapshotRef.current = next;
      setSnapshot(next);
      void syncTopics(next);
    },
    [syncTopics],
  );

  useEffect(() => connection.subscribeStatus(setStatus), [connection]);

  // conn 通道：只记真正连上 / 断开 / 失败，connecting 之类不刷屏。
  useEffect(() => {
    const previous = lastStatus.current;
    lastStatus.current = status;
    if (previous === status) {
      return;
    }
    if (status === "open") {
      logs.conn.info("conn.open", { endpoint: connection.endpoint });
    } else if (status === "closed") {
      logs.conn.info("conn.closed", { endpoint: connection.endpoint });
    } else if (status === "failed") {
      logs.conn.error("conn.failed", { endpoint: connection.endpoint });
    }
  }, [status, connection, logs]);

  useEffect(() => {
    connection.connect();
  }, [connection]);

  /** 请一次全量快照。用户导航与补丁失败都走这里。 */
  const requestRender = useCallback(
    async (page: string | null) => {
      const seq = renderSeq.current + 1;
      renderSeq.current = seq;
      const started = performance.now();
      try {
        const value = await connection.call("ui", "render", page === null ? {} : { page });
        if (seq !== renderSeq.current) {
          logs.render.debug("render.stale", { page: page ?? "" });
          return;
        }
        if (!isSnapshot(value)) {
          console.error("[omora] ui 返回的不是页面快照:", value);
          return;
        }
        const next = value;
        if (snapshotRef.current === null) {
          const booted = bootPages.current;
          if (booted !== null && isStale(booted, next.pages)) {
            logs.render.warning("static.stale", {
              pages: next.pages.map((entry) => entry.name).join(","),
            });
          }
        }
        logs.render.debug("render.received", {
          page: next.page,
          nodes: countNodes(next.content),
          version: next.version,
          ms: elapsedMs(started),
        });
        pageRef.current = next.page;
        applySnapshot(next);
      } catch (error) {
        console.error("[omora] 调用失败:", error);
      }
    },
    [connection, logs, applySnapshot],
  );

  // 先报能力、再订阅、最后画当前页：audio / video 是按能力装的，装完页面才多两个捕捉块。
  // 每一步都跟着这次 open 的代号走；断线后旧重放停在原地，重连后从头再来。
  useEffect(() => {
    if (status !== "open") {
      replayed.current = false;
      // 服务端断线即清空订阅，这里跟着复位，重连后从快照重新订。
      subscribed.current = [];
      return;
    }
    if (replayed.current) {
      return;
    }
    replayed.current = true;
    const generation = replaySeq.current + 1;
    replaySeq.current = generation;

    void (async () => {
      try {
        await reportDevicesOnce(connection);
      } catch (error) {
        logs.conn.warning("capability.report_failed", { err: errorText(error) });
      }
      if (generation !== replaySeq.current) {
        return;
      }

      try {
        const result = await connection.subscribe([SNAPSHOT_TOPIC]);
        subscribed.current = result.topics;
        logs.conn.debug("subscribe.done", { topics: result.topics });
      } catch (error) {
        logs.conn.warning("subscribe.failed", { err: errorText(error) });
      }
      if (generation !== replaySeq.current) {
        return;
      }

      await requestRender(pageRef.current);
    })();
  }, [status, connection, logs, requestRender]);

  // 视图推送的唯一入口：全量替换或补丁；属于别的页的更新直接忽略。
  useEffect(() => {
    return connection.onEvent(SNAPSHOT_TOPIC, (payload) => {
      const current = snapshotRef.current;
      if (current === null) {
        logs.render.debug("snapshot.waiting", {});
        void requestRender(pageRef.current);
        return;
      }

      const update = applySnapshotUpdate(current, payload);
      if (update.ok) {
        logs.render.debug("snapshot.applied", {
          page: update.snapshot.page,
          nodes: countNodes(update.snapshot.content),
          version: update.snapshot.version,
        });
        applySnapshot(update.snapshot);
        return;
      }
      if (update.reason === "page") {
        logs.render.debug("snapshot.other_page", { page: current.page });
        return;
      }
      logs.render.debug("snapshot.miss", { reason: update.reason, page: current.page });
      void requestRender(pageRef.current);
    });
  }, [connection, logs, applySnapshot, requestRender]);

  const navigate = useCallback(
    (page: string) => {
      pageRef.current = page;
      void requestRender(page);
    },
    [requestRender],
  );

  const handleEvent = useCallback(
    (handler: string, payload?: JsonObject) => {
      const body = payload ?? {};
      logs.event.debug("event.sent", {
        handler,
        keys: Object.keys(body).join(","),
      });
      // ui.event 的 result 只有确认（{}），视图变化走 ui.snapshot，不在这里取快照。
      void connection.call("ui", "event", { handler, payload: body }).catch((error: unknown) => {
        console.error("[omora] 调用失败:", error);
      });
    },
    [connection, logs],
  );

  const loadMedia = useCallback(
    (media: string) => {
      const started = performance.now();
      return fetchMedia(
        (target, method, args) => connection.call(target, method, args),
        media,
      ).catch((error: unknown) => {
        logs.media.error("media.failed", {
          media,
          ms: elapsedMs(started),
          err: errorText(error),
        });
        throw error;
      });
    },
    [connection, logs],
  );

  // 组合是纯函数：快照一变就重算，未触碰的子树保持引用（memo 靠它）。
  const view = useMemo(() => withContributions(snapshot), [snapshot]);

  return (
    <Shell
      snapshot={view}
      status={status}
      endpoint={connection.endpoint}
      onNavigate={navigate}
      onEvent={handleEvent}
      loadMedia={loadMedia}
    />
  );
}

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { reportCapabilitiesOnce } from "./core/capability-report";
import { Connection, type ConnectionStatus } from "./core/connection";
import type { Logger } from "./core/log";
import { fetchMedia } from "./media/media";
import type { JsonObject } from "./core/protocol";
import { Shell } from "./shell/shell";
import type { Node, Snapshot } from "./core/types";

export interface AppProps {
  connection: Connection;
  logger: Logger;
}

/** ui 的返回值必须是页面快照；不是就丢掉，别把壳画坏。 */
function asSnapshot(value: unknown): Snapshot | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.pages)) {
    return null;
  }
  if (typeof record.page !== "string") {
    return null;
  }
  if (typeof record.meta !== "string") {
    return null;
  }
  if (typeof record.content !== "object" || record.content === null) {
    return null;
  }
  return value as Snapshot;
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
 * 连上 → render；点导航 → render(name)；回车 / 点动作 → event。
 */
export function App({ connection, logger }: AppProps): ReactNode {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const requested = useRef(false);
  const lastStatus = useRef<ConnectionStatus | null>(null);

  const logs = useMemo(
    () => ({
      conn: logger.child("conn"),
      render: logger.child("render"),
      event: logger.child("event"),
      media: logger.child("media"),
    }),
    [logger],
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

  const send = useCallback(
    async (method: string, args: JsonObject) => {
      const started = performance.now();
      try {
        const value = await connection.call("ui", method, args);
        const next = asSnapshot(value);
        if (next === null) {
          console.error("[omora] ui 返回的不是页面快照:", value);
          return;
        }
        if (method === "render") {
          logs.render.debug("render.received", {
            page: next.page,
            nodes: countNodes(next.content),
            ms: elapsedMs(started),
          });
        }
        setSnapshot(next);
      } catch (error) {
        console.error("[omora] 调用失败:", error);
      }
    },
    [connection, logs],
  );

  // 先报能力、再画首屏：audio / video 是按能力装的，装完页面才多两个捕捉块
  useEffect(() => {
    if (status !== "open" || requested.current) {
      return;
    }
    requested.current = true;
    void reportCapabilitiesOnce(connection)
      .catch((error: unknown) => {
        logs.conn.warning("capability.report_failed", { err: errorText(error) });
      })
      .finally(() => {
        void send("render", {});
      });
  }, [status, connection, send, logs]);

  const navigate = useCallback(
    (page: string) => {
      void send("render", { page });
    },
    [send],
  );

  const handleEvent = useCallback(
    (handler: string, payload?: JsonObject) => {
      const body = payload ?? {};
      logs.event.debug("event.sent", {
        handler,
        keys: Object.keys(body).join(","),
      });
      void send("event", { handler, payload: body });
    },
    [send, logs],
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

  return (
    <Shell
      snapshot={snapshot}
      status={status}
      endpoint={connection.endpoint}
      onNavigate={navigate}
      onEvent={handleEvent}
      loadMedia={loadMedia}
    />
  );
}

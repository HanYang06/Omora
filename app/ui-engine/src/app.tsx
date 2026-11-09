import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Connection, type ConnectionStatus } from "./connection";
import type { JsonObject } from "./protocol";
import { fetchMedia } from "./media";
import { Shell } from "./shell";
import type { Snapshot } from "./types";

export interface AppProps {
  connection: Connection;
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

/**
 * 默认母页面的容器：持有快照与连接状态。
 * 连上 → render；点导航 → render(name)；回车 / 点动作 → event。
 */
export function App({ connection }: AppProps): ReactNode {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const requested = useRef(false);

  useEffect(() => connection.subscribeStatus(setStatus), [connection]);

  useEffect(() => {
    connection.connect();
  }, [connection]);

  const send = useCallback(
    async (method: string, args: JsonObject) => {
      try {
        const value = await connection.call("ui", method, args);
        const next = asSnapshot(value);
        if (next === null) {
          console.error("[omora] ui 返回的不是页面快照:", value);
          return;
        }
        setSnapshot(next);
      } catch (error) {
        console.error("[omora] 调用失败:", error);
      }
    },
    [connection],
  );

  useEffect(() => {
    if (status !== "open" || requested.current) {
      return;
    }
    requested.current = true;
    void send("render", {});
  }, [status, send]);

  const navigate = useCallback(
    (page: string) => {
      void send("render", { page });
    },
    [send],
  );

  const handleEvent = useCallback(
    (handler: string, payload?: JsonObject) => {
      void send("event", { handler, payload: payload ?? {} });
    },
    [send],
  );

  const loadMedia = useCallback(
    (media: string) => fetchMedia((target, method, args) => connection.call(target, method, args), media),
    [connection],
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
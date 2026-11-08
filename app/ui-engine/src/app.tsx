import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Connection, type ConnectionStatus } from "./connection";
import type { JsonObject } from "./protocol";
import { renderTree } from "./renderer";
import type { Node } from "./types";

const STATUS_TEXT: Record<ConnectionStatus, string> = {
  idle: "未连接",
  connecting: "连接中…",
  open: "已连接",
  closed: "连接已断开",
  failed: "连接失败",
};

export interface AppProps {
  connection: Connection;
}

/**
 * 默认母页面。只持有两样东西：当前节点数组、连接状态。
 * 渲染 → 事件 → 整棵树替换；不做 diff，也不缓存 Python 侧的真相。
 */
export function App({ connection }: AppProps): ReactNode {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const requestedRender = useRef(false);

  useEffect(() => connection.subscribeStatus(setStatus), [connection]);

  useEffect(() => {
    connection.connect();
  }, [connection]);

  const send = useCallback(
    async (target: string, method: string, args: JsonObject) => {
      try {
        const value = await connection.call(target, method, args);
        if (Array.isArray(value)) {
          setNodes(value as Node[]);
        } else {
          console.error("[omora] result.value 必须是节点数组:", value);
        }
      } catch (error) {
        console.error("[omora] 调用失败:", error);
      }
    },
    [connection],
  );

  useEffect(() => {
    if (status !== "open" || requestedRender.current) {
      return;
    }
    requestedRender.current = true;
    void send("ui", "render", { view: "main" });
  }, [status, send]);

  const handleEvent = useCallback(
    (handler: string) => {
      void send("ui", "event", { handler, payload: {} });
    },
    [send],
  );

  return (
    <main className="omora-main" data-connection={status}>
      <p className="omora-status" data-status={status} role="status">
        {status === "failed"
          ? `${STATUS_TEXT[status]}：${connection.endpoint} 不可达`
          : STATUS_TEXT[status]}
      </p>
      {nodes.length > 0 ? (
        <div className="omora-tree">{renderTree(nodes, handleEvent)}</div>
      ) : null}
    </main>
  );
}

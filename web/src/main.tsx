import { StrictMode, useEffect, useRef, useState, type ReactElement } from "react";
import { createRoot } from "react-dom/client";

import type { CmdInvokeParams } from "./contract";
import { C1Client, type C1Status } from "./rpc/c1";
import { contributionsFromUi } from "./shell/contributions";
import { Shell } from "./shell/shell";
import { emptyProjection, fromSnapshot, type Projection } from "./store/projection";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/widgets.css";

const DEFAULT_WS_URL = "ws://127.0.0.1:8765";

function resolveWsUrl(): string {
  const override = new URLSearchParams(window.location.search).get("ws");
  if (override !== null && (override.startsWith("ws://") || override.startsWith("wss://"))) {
    return override;
  }
  return DEFAULT_WS_URL;
}

function App(): ReactElement {
  const clientRef = useRef<C1Client | null>(null);
  const [projection, setProjection] = useState<Projection>(emptyProjection);
  const [status, setStatus] = useState<C1Status>("connecting");

  useEffect(() => {
    const client = new C1Client({
      url: resolveWsUrl(),
      onSnapshot: (snapshot) => {
        setProjection(fromSnapshot(snapshot));
      },
      onEvent: () => {
        const active = clientRef.current;
        if (active !== null) {
          setProjection(active.getProjection());
        }
      },
      onStatus: (next) => {
        setStatus(next);
      },
    });
    clientRef.current = client;
    try {
      void client.connect().catch(() => undefined);
    } catch {
      setStatus("closed");
    }
    return () => {
      clientRef.current = null;
      client.close();
    };
  }, []);

  const handleCommand = (command: CmdInvokeParams): void => {
    const client = clientRef.current;
    if (client === null) {
      return;
    }
    void client.cmdInvoke(command).catch(() => undefined);
  };

  return (
    <Shell
      contributions={contributionsFromUi(projection.ui, projection.state)}
      commands={projection.ui.commands ?? []}
      revision={projection.revision}
      status={status}
      onCommand={handleCommand}
    />
  );
}

const rootElement = document.getElementById("root");
if (rootElement === null) {
  throw new Error("找不到 #root 挂载点");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

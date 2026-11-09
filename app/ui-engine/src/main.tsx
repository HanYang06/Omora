import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import { reportCapabilities } from "./capability-report";
import { Connection } from "./connection";
import "./styles.css";
import "./media.css";

const container = document.getElementById("root");
if (container === null) {
  throw new Error("缺少 #root 挂载点");
}

const connection = new Connection();

// 能力检测的唯一来源是 capture 的 devices.ts；它落地前这里按"没有能力"上报，
// 不去探测硬件。接入时把 detectCapabilities 作为第二个参数传进来。
reportCapabilities(connection, async () => []);

createRoot(container).render(
  <StrictMode>
    <App connection={connection} />
  </StrictMode>,
);

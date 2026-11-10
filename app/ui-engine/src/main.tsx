import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import { Connection } from "./connection";
import { createLogger } from "./log";
import "./styles.css";
import "./media.css";

const container = document.getElementById("root");
if (container === null) {
  throw new Error("缺少 #root 挂载点");
}

const connection = new Connection();
const logger = createLogger({
  call: (target, method, args) => connection.call(target, method, args),
});

createRoot(container).render(
  <StrictMode>
    <App connection={connection} logger={logger} />
  </StrictMode>,
);
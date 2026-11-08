import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import { Connection } from "./connection";
import "./styles.css";

const container = document.getElementById("root");
if (container === null) {
  throw new Error("缺少 #root 挂载点");
}

const connection = new Connection();

createRoot(container).render(
  <StrictMode>
    <App connection={connection} />
  </StrictMode>,
);

import { Connection } from "../core/connection";
import { createLogger } from "../core/log";
import { DomApp } from "./app";
import "../styles/styles.css";
import "../styles/media.css";

const container = document.getElementById("root");
if (container === null) {
  throw new Error("缺少 #root 挂载点");
}

const connection = new Connection();
const logger = createLogger({
  call: (target, method, args) => connection.call(target, method, args),
});
new DomApp(connection, logger).mount(container);

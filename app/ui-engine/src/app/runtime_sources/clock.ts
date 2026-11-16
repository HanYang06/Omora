import type { SlotNode } from "../../contract/document";
import { WINDOW_ANCHORS } from "../../link/scaffold";
import type { RuntimeSource } from "../runtime_sources";

/**
 * 示例运行后来源：不碰引擎源码，往导航栏底部挂一个时钟；每秒热更新一次。
 *
 * 它验证两件事：加一个文件就能加界面（自动发现 + 注册）与来源热更新
 * （SourceEngine.registerSource 整组替换，其他来源与主视图不受影响）。
 */

const OWNER = "runtime.clock";

function clockRoot(): SlotNode {
  const text = new Date().toLocaleTimeString("zh-CN", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  });
  return {
    id: "runtime.clock",
    kind: "dendro:text",
    owner: OWNER,
    props: { text, kind: "muted" },
    children: [],
  };
}

const clock: RuntimeSource = {
  owner: OWNER,
  mountAt: WINDOW_ANCHORS.nav,
  order: 100,
  build: clockRoot,
  start(push) {
    const timer = setInterval(() => {
      push(clockRoot());
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  },
};

export default clock;

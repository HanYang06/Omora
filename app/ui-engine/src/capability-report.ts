import type { Connection } from "./connection";

/** 客户端能力由 capture 的 devices.ts 枚举；这里只负责把结果交给 manager。 */
export type CapabilityDetector = () => Promise<readonly string[]>;

export const CAPABILITY_TARGET = "manager";
export const CAPABILITY_METHOD = "report_capabilities";

/**
 * 连接第一次 open 时上报一次客户端能力。
 *
 * 能力是本机的、每个客户端各算各的：引擎负责知道客户端能开什么，
 * Python 侧只保存"最后上报的那份"给设置页用，不自己探测硬件。
 * 未连接不发；v0 不重连，所以一次就够。返回取消订阅的函数。
 */
export function reportCapabilities(
  connection: Pick<Connection, "subscribeStatus" | "call">,
  detect: CapabilityDetector,
): () => void {
  let reported = false;
  return connection.subscribeStatus((status) => {
    if (status !== "open" || reported) {
      return;
    }
    reported = true;
    void detect()
      .then((capabilities) =>
        connection.call(CAPABILITY_TARGET, CAPABILITY_METHOD, {
          capabilities: [...capabilities],
        }),
      )
      .catch((error: unknown) => {
        console.error("[omora] 上报客户端能力失败:", error);
      });
  });
}

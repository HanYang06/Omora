import type { Connection } from "./connection";
import { detectCapabilities } from "../capture/devices";

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

/**
 * 上报一次，等它真的到岸再返回。
 *
 * 首屏渲染必须排在它后面：audio / video 是按能力条件装的，装完页面才会多出
 * 录音、视频两个捕捉块。先渲染再上报，会渲染出一份"少两个按钮"的快照。
 */
export async function reportCapabilitiesOnce(
  connection: Pick<Connection, "call">,
  detect: CapabilityDetector = detectCapabilities,
): Promise<void> {
  const capabilities = await detect();
  await connection.call(CAPABILITY_TARGET, CAPABILITY_METHOD, {
    capabilities: [...capabilities],
  });
}

/**
 * 引擎的默认接线：连上后把 devices.ts 检测到的客户端能力报给 manager。
 * 设备检测只有这一处来源；别的模块不要再调 manager.report_capabilities。
 */
export function reportClientCapabilities(
  connection: Pick<Connection, "subscribeStatus" | "call">,
): () => void {
  return reportCapabilities(connection, detectCapabilities);
}

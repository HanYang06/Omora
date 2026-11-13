import type { Connection } from "./connection";
import { detectDevices } from "../platform/capture/devices";

/**
 * 客户端设备事实：引擎枚举完交给 manager，由插件自己解释。
 *
 * 引擎不认识"麦克风"这种产品词，只报 audioinput / videoinput 这些平台名字；
 * 谁需要什么、缺了要不要藏界面，都是插件自己的判断。
 */
export type DeviceDetector = () => Promise<readonly string[]>;

export const DEVICE_TARGET = "manager";
export const DEVICE_METHOD = "report_devices";

/** 连接第一次 open 时上报一次；返回取消订阅的函数。 */
export function reportDevices(
  connection: Pick<Connection, "subscribeStatus" | "call">,
  detect: DeviceDetector,
): () => void {
  let reported = false;
  return connection.subscribeStatus((status) => {
    if (status !== "open" || reported) {
      return;
    }
    reported = true;
    void detect()
      .then((devices) =>
        connection.call(DEVICE_TARGET, DEVICE_METHOD, {
          devices: [...devices],
        }),
      )
      .catch((error: unknown) => {
        console.error("[omora] 上报客户端设备失败:", error);
      });
  });
}

/**
 * 上报一次，等它真的到岸再返回。
 *
 * 首屏渲染排在它后面：插件要按设备事实决定出不出捕捉块。
 */
export async function reportDevicesOnce(
  connection: Pick<Connection, "call">,
  detect: DeviceDetector = detectDevices,
): Promise<void> {
  const devices = await detect();
  await connection.call(DEVICE_TARGET, DEVICE_METHOD, {
    devices: [...devices],
  });
}

/** 引擎的默认接线：连上后把 devices.ts 枚举到的设备事实报给 manager。 */
export function reportClientDevices(
  connection: Pick<Connection, "subscribeStatus" | "call">,
): () => void {
  return reportDevices(connection, detectDevices);
}

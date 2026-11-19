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

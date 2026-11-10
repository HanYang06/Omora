import { useCallback, useEffect, useRef, useState } from "react";
import {
  createDeviceTracker,
  defaultDeviceSource,
  pendingState,
  unsupportedState,
  type DeviceSource,
  type DeviceState,
  type DeviceTracker,
} from "./devices";

export interface DeviceHandle {
  state: DeviceState;
  refresh: () => void;
}

/**
 * 设备状态：挂上就枚举，之后跟着 devicechange 走；卸载时摘掉监听。
 *
 * `source` 只有测试会传；真实渲染里没人传，所以这里必须回落到浏览器的
 * navigator.mediaDevices —— 早先没回落，界面上就一直是"不支持媒体设备"。
 */
export function useMediaDevices(source?: DeviceSource): DeviceHandle {
  const resolved = source ?? defaultDeviceSource();
  const [state, setState] = useState<DeviceState>(() =>
    resolved === undefined ? unsupportedState() : pendingState(),
  );
  const tracker = useRef<DeviceTracker | null>(null);

  useEffect(() => {
    if (resolved === undefined) {
      setState(unsupportedState());
      return;
    }
    const made = createDeviceTracker(resolved, setState);
    tracker.current = made;
    void made.refresh();
    return () => {
      made.stop();
      tracker.current = null;
    };
  }, [resolved]);

  const refresh = useCallback(() => {
    void tracker.current?.refresh();
  }, []);

  return { state, refresh };
}
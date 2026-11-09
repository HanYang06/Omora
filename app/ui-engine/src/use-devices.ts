import { useCallback, useEffect, useRef, useState } from "react";
import {
  createDeviceTracker,
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

/** 设备状态：挂上就枚举，之后跟着 devicechange 走；卸载时摘掉监听。 */
export function useMediaDevices(source?: DeviceSource): DeviceHandle {
  const [state, setState] = useState<DeviceState>(() =>
    source === undefined ? unsupportedState() : pendingState(),
  );
  const tracker = useRef<DeviceTracker | null>(null);

  useEffect(() => {
    if (source === undefined) {
      setState(unsupportedState());
      return;
    }
    const made = createDeviceTracker(source, setState);
    tracker.current = made;
    void made.refresh();
    return () => {
      made.stop();
      tracker.current = null;
    };
  }, [source]);

  const refresh = useCallback(() => {
    void tracker.current?.refresh();
  }, []);

  return { state, refresh };
}

import type { ReactNode } from "react";
import { deviceLabel, type DeviceInfo, type DeviceKind } from "./devices";

export interface DeviceSelectProps {
  devices: DeviceInfo[];
  kind: DeviceKind;
  value: string | undefined;
  disabled?: boolean;
  onChange: (deviceId: string) => void;
}

/** 多设备时才有意义：选这次用哪个麦克风 / 摄像头。 */
export function DeviceSelect({
  devices,
  kind,
  value,
  disabled,
  onChange,
}: DeviceSelectProps): ReactNode {
  return (
    <select
      className="omora-device"
      data-type="device_select"
      aria-label={kind === "audioinput" ? "选择麦克风" : "选择摄像头"}
      value={value ?? ""}
      disabled={disabled}
      onChange={(event) => onChange(event.currentTarget.value)}
    >
      {devices.map((device, index) => (
        <option
          key={device.deviceId.length > 0 ? device.deviceId : String(index)}
          value={device.deviceId}
        >
          {deviceLabel(device, index, kind)}
        </option>
      ))}
    </select>
  );
}

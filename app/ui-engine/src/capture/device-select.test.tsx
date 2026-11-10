import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DeviceSelect } from "./device-select";

describe("DeviceSelect", () => {
  it("列出每个设备，当前选中的那个是 value", () => {
    const onChange = vi.fn();
    const html = renderToString(
      <DeviceSelect
        devices={[
          { deviceId: "mic-1", label: "内置麦克风" },
          { deviceId: "mic-2", label: "USB 麦克风" },
        ]}
        kind="audioinput"
        value="mic-2"
        onChange={onChange}
      />,
    );

    expect(html).toContain('aria-label="选择麦克风"');
    expect(html).toContain("内置麦克风");
    expect(html).toContain("USB 麦克风");
    expect(html).toContain('value="mic-2"');
  });

  it("视频选择器说摄像头", () => {
    const html = renderToString(
      <DeviceSelect
        devices={[{ deviceId: "cam-1", label: "" }]}
        kind="videoinput"
        value="cam-1"
        onChange={() => {}}
      />,
    );

    expect(html).toContain('aria-label="选择摄像头"');
    expect(html).toContain("摄像头 1");
  });
});

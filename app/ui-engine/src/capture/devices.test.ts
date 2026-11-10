import { describe, expect, it, vi } from "vitest";
import {
  captureErrorReason,
  captureGate,
  capabilitiesOf,
  createDeviceTracker,
  detectCapabilities,
  deviceLabel,
  groupDevices,
  pendingState,
  unsupportedState,
  type DeviceSource,
  type DeviceState,
  type MediaDeviceInfoLike,
} from "./devices";

const MIC = { deviceId: "mic-1", kind: "audioinput", label: "麦克风" };
const CAM = { deviceId: "cam-1", kind: "videoinput", label: "摄像头" };

class FakeDevices implements DeviceSource {
  devices: MediaDeviceInfoLike[] = [];
  private listeners = new Set<() => void>();

  async enumerateDevices(): Promise<readonly MediaDeviceInfoLike[]> {
    return this.devices;
  }

  addEventListener(_type: "devicechange", listener: () => void): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: "devicechange", listener: () => void): void {
    this.listeners.delete(listener);
  }

  get listenerCount(): number {
    return this.listeners.size;
  }

  plug(...plugged: MediaDeviceInfoLike[]): void {
    this.devices = [...this.devices, ...plugged];
    this.fire();
  }

  unplug(kind: string): void {
    this.devices = this.devices.filter((device) => device.kind !== kind);
    this.fire();
  }

  private fire(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

function errorNamed(name: string): Error {
  const error = new Error(name);
  error.name = name;
  return error;
}

describe("设备门禁", () => {
  it("没有设备接口就禁用，并写清原因", () => {
    const gate = captureGate(unsupportedState(), "audioinput");

    expect(gate.enabled).toBe(false);
    expect(gate.reason).toBe("不支持媒体设备采集");
  });

  it("还没枚举完就禁用，不假装能用", () => {
    expect(captureGate(pendingState(), "videoinput")).toMatchObject({
      enabled: false,
      reason: "正在检测设备…",
    });
  });

  it("只有麦克风时：音频可用，视频禁用——缺一个不连坐另一个", async () => {
    const source = new FakeDevices();
    source.devices = [MIC];
    const tracker = createDeviceTracker(source);

    await tracker.refresh();

    expect(captureGate(tracker.state, "audioinput").enabled).toBe(true);
    expect(captureGate(tracker.state, "videoinput")).toMatchObject({
      enabled: false,
      reason: "未检测到摄像头",
    });
    tracker.stop();
  });

  it("一个设备都没有时两类都禁用，且理由各说各的", async () => {
    const source = new FakeDevices();
    const tracker = createDeviceTracker(source);

    await tracker.refresh();

    expect(captureGate(tracker.state, "audioinput").reason).toBe("未检测到麦克风");
    expect(captureGate(tracker.state, "videoinput").reason).toBe("未检测到摄像头");
    tracker.stop();
  });

  it("多设备都进清单，选择器才有得选", async () => {
    const source = new FakeDevices();
    source.devices = [MIC, { deviceId: "mic-2", kind: "audioinput", label: "USB 麦克风" }];
    const tracker = createDeviceTracker(source);

    await tracker.refresh();

    const gate = captureGate(tracker.state, "audioinput");
    expect(gate.devices).toHaveLength(2);
    expect(gate.devices.map((device, index) => deviceLabel(device, index, "audioinput"))).toEqual([
      "麦克风",
      "USB 麦克风",
    ]);
    tracker.stop();
  });

  it("热插拔：插上摄像头后，视频从禁用变成可用", async () => {
    const source = new FakeDevices();
    source.devices = [MIC];
    const tracker = createDeviceTracker(source);
    await tracker.refresh();
    expect(captureGate(tracker.state, "videoinput").enabled).toBe(false);

    source.plug(CAM);

    await vi.waitFor(() => {
      expect(captureGate(tracker.state, "videoinput").enabled).toBe(true);
    });
    tracker.stop();
  });

  it("热插拔：拔掉麦克风后，音频立刻禁用而视频不受影响", async () => {
    const source = new FakeDevices();
    source.devices = [MIC, CAM];
    const tracker = createDeviceTracker(source);
    await tracker.refresh();

    source.unplug("audioinput");

    await vi.waitFor(() => {
      expect(captureGate(tracker.state, "audioinput").enabled).toBe(false);
    });
    expect(captureGate(tracker.state, "videoinput").enabled).toBe(true);
    tracker.stop();
  });

  it("停掉之后不再听 devicechange，也不会再更新状态", async () => {
    const source = new FakeDevices();
    source.devices = [MIC];
    const onChange = vi.fn<(state: DeviceState) => void>();
    const tracker = createDeviceTracker(source, onChange);
    await tracker.refresh();

    tracker.stop();
    source.plug(CAM);
    await Promise.resolve();

    expect(source.listenerCount).toBe(0);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(tracker.state.videoinput).toHaveLength(0);
  });

  it("枚举失败不当成没有设备，而是禁用并给出可读状态", async () => {
    const source = new FakeDevices();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(source, "enumerateDevices").mockRejectedValue(new Error("boom"));
    const tracker = createDeviceTracker(source);

    await tracker.refresh();

    expect(tracker.state.ready).toBe(true);
    expect(captureGate(tracker.state, "audioinput").enabled).toBe(false);
    tracker.stop();
    vi.restoreAllMocks();
  });
});

describe("设备词表", () => {
  it("只留下音频与视频输入，输出设备不管", () => {
    const grouped = groupDevices([
      MIC,
      CAM,
      { deviceId: "spk", kind: "audiooutput", label: "扬声器" },
    ]);

    expect(grouped.audioinput).toHaveLength(1);
    expect(grouped.videoinput).toHaveLength(1);
  });

  it("没有标签的设备也给一个能读的编号", () => {
    expect(deviceLabel({ deviceId: "", label: "" }, 1, "audioinput")).toBe("麦克风 2");
    expect(deviceLabel({ deviceId: "", label: "" }, 0, "videoinput")).toBe("摄像头 1");
  });

  it("能力名与插件元数据一致", () => {
    expect(
      capabilitiesOf({ ...pendingState(), audioinput: [{ deviceId: "a", label: "" }] }),
    ).toEqual(["microphone"]);
    expect(
      capabilitiesOf({
        ...pendingState(),
        audioinput: [{ deviceId: "a", label: "" }],
        videoinput: [{ deviceId: "v", label: "" }],
      }),
    ).toEqual(["microphone", "camera"]);
  });

  it("上报能力：有麦克风和摄像头就报两个", async () => {
    const source = new FakeDevices();
    source.devices = [MIC, CAM];

    expect(await detectCapabilities(source)).toEqual(["microphone", "camera"]);
  });

  it("上报能力：没有设备就报空，不猜", async () => {
    expect(await detectCapabilities(new FakeDevices())).toEqual([]);
  });

  it("上报能力：环境里没有媒体接口也报空", async () => {
    expect(await detectCapabilities()).toEqual([]);
  });

  it("getUserMedia 的错翻成人话", () => {
    expect(captureErrorReason(errorNamed("NotAllowedError"), "audioinput")).toBe("需要麦克风权限");
    expect(captureErrorReason(errorNamed("NotFoundError"), "videoinput")).toBe("未检测到摄像头");
    expect(captureErrorReason(errorNamed("NotReadableError"), "videoinput")).toBe(
      "摄像头被别的程序占用",
    );
    expect(captureErrorReason(new Error("?"), "audioinput")).toBe("打不开麦克风");
  });
});

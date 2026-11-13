/**
 * 客户端硬件检测：设备、权限、热插拔。
 *
 * 硬件只有浏览器看得见，所以检测在渲染引擎这一侧；Python 只给质量档与时限。
 * 没有对应设备时，对应捕捉默认禁用——按钮留着，把原因写清楚。
 */

export type DeviceKind = "audioinput" | "videoinput";

export interface DeviceInfo {
  deviceId: string;
  label: string;
}

export interface DeviceState {
  /** 浏览器有没有 mediaDevices（没有就彻底禁用） */
  supported: boolean;
  /** 枚举过一轮没有（没有之前一律禁用，理由是"正在检测"） */
  ready: boolean;
  audioinput: DeviceInfo[];
  videoinput: DeviceInfo[];
}

export interface MediaDeviceInfoLike {
  deviceId: string;
  kind: string;
  label: string;
}

/** navigator.mediaDevices 的子集；测试里传假的。 */
export interface DeviceSource {
  enumerateDevices(): Promise<readonly MediaDeviceInfoLike[]>;
  getUserMedia?(constraints: MediaStreamConstraints): Promise<MediaStream>;
  addEventListener?(type: "devicechange", listener: () => void): void;
  removeEventListener?(type: "devicechange", listener: () => void): void;
}

export function unsupportedState(): DeviceState {
  return { supported: false, ready: true, audioinput: [], videoinput: [] };
}

export function pendingState(): DeviceState {
  return { supported: true, ready: false, audioinput: [], videoinput: [] };
}

/** 枚举结果 → 两类设备各自的清单。 */
export function groupDevices(raw: readonly MediaDeviceInfoLike[]): {
  audioinput: DeviceInfo[];
  videoinput: DeviceInfo[];
} {
  const audioinput: DeviceInfo[] = [];
  const videoinput: DeviceInfo[] = [];
  for (const device of raw) {
    const info: DeviceInfo = {
      deviceId: typeof device.deviceId === "string" ? device.deviceId : "",
      label: typeof device.label === "string" ? device.label : "",
    };
    if (device.kind === "audioinput") {
      audioinput.push(info);
    } else if (device.kind === "videoinput") {
      videoinput.push(info);
    }
  }
  return { audioinput, videoinput };
}

export interface Gate {
  enabled: boolean;
  reason?: string;
  devices: DeviceInfo[];
}

/** 这个能力现在能不能用；不能用就给一句人话的理由。 */
export function captureGate(state: DeviceState, kind: DeviceKind): Gate {
  const devices = state[kind];
  const noun = kind === "audioinput" ? "麦克风" : "摄像头";
  if (!state.supported) {
    return { enabled: false, reason: "不支持媒体设备采集", devices };
  }
  if (!state.ready) {
    return { enabled: false, reason: "正在检测设备…", devices };
  }
  if (devices.length === 0) {
    return { enabled: false, reason: `未检测到${noun}`, devices };
  }
  return { enabled: true, devices };
}

/**
 * 客户端这台机器上有哪些设备种类。
 *
 * 引擎只报平台事实（audioinput / videoinput），不翻译成产品词：
 * "有没有麦克风、要不要出捕捉块"是插件自己判断的事。
 */
export function deviceKindsOf(state: DeviceState): DeviceKind[] {
  const found: DeviceKind[] = [];
  if (state.audioinput.length > 0) {
    found.push("audioinput");
  }
  if (state.videoinput.length > 0) {
    found.push("videoinput");
  }
  return found;
}

/** 设备没有名字（权限还没给）时也得有个能读的标签。 */
export function deviceLabel(device: DeviceInfo, index: number, kind: DeviceKind): string {
  if (device.label.length > 0) {
    return device.label;
  }
  return `${kind === "audioinput" ? "麦克风" : "摄像头"} ${index + 1}`;
}

/** getUserMedia 抛的错 → 一句能放在按钮旁边的理由。 */
export function captureErrorReason(error: unknown, kind: DeviceKind): string {
  const name = error instanceof Error ? error.name : "";
  const noun = kind === "audioinput" ? "麦克风" : "摄像头";
  if (name === "NotAllowedError") {
    return `需要${noun}权限`;
  }
  if (name === "NotFoundError") {
    return `未检测到${noun}`;
  }
  if (name === "NotReadableError") {
    return `${noun}被别的程序占用`;
  }
  return `打不开${noun}`;
}

/** 浏览器给的设备来源；没有 mediaDevices（SSR、老浏览器、非安全上下文）就是 undefined。 */
export function defaultDeviceSource(): DeviceSource | undefined {
  if (typeof navigator === "undefined") {
    return undefined;
  }
  return navigator.mediaDevices;
}

/** 打开设备。只在用户点了按钮之后调：浏览器只认手势里的权限请求。 */
export function openMediaStream(
  source: DeviceSource | undefined,
  constraints: MediaStreamConstraints,
): Promise<MediaStream> {
  if (source?.getUserMedia !== undefined) {
    return source.getUserMedia(constraints);
  }
  const devices = defaultDeviceSource();
  if (devices?.getUserMedia === undefined) {
    return Promise.reject(new Error("不支持媒体设备采集"));
  }
  return devices.getUserMedia(constraints);
}

/**
 * 一次性问本机有哪些设备：给 manager 的 report_devices 用（上报一次，不在别处再报）。
 * 只枚举、不要权限：用户没点过就不该弹窗。没有 mediaDevices 或没有设备就返回空。
 */
export async function detectDevices(source?: DeviceSource): Promise<readonly DeviceKind[]> {
  const tracker = createDeviceTracker(source ?? defaultDeviceSource());
  try {
    return deviceKindsOf(await tracker.refresh());
  } finally {
    tracker.stop();
  }
}

export interface DeviceTracker {
  readonly state: DeviceState;
  refresh(): Promise<DeviceState>;
  stop(): void;
}

/**
 * 设备跟踪：先枚举一次，之后每次 devicechange 重新枚举——
 * 插上摄像头就立刻能用，拔掉就立刻禁用。
 */
export function createDeviceTracker(
  source?: DeviceSource,
  onChange?: (state: DeviceState) => void,
): DeviceTracker {
  let state = source === undefined ? unsupportedState() : pendingState();
  let stopped = false;
  const notify = (): void => {
    onChange?.(state);
  };
  const refresh = async (): Promise<DeviceState> => {
    if (source === undefined) {
      notify();
      return state;
    }
    try {
      const raw = await source.enumerateDevices();
      state = { supported: true, ready: true, ...groupDevices(raw) };
    } catch (error) {
      console.error("[omora] 枚举设备失败:", error);
      state = { supported: true, ready: true, audioinput: [], videoinput: [] };
    }
    notify();
    return state;
  };
  const onDeviceChange = (): void => {
    if (stopped) {
      return;
    }
    void refresh();
  };
  if (source !== undefined) {
    source.addEventListener?.("devicechange", onDeviceChange);
  }
  return {
    get state(): DeviceState {
      return state;
    },
    refresh,
    stop(): void {
      if (stopped) {
        return;
      }
      stopped = true;
      source?.removeEventListener?.("devicechange", onDeviceChange);
    },
  };
}

import { afterEach, beforeEach, vi } from "vitest";
import type { Node } from "../core/types";
import type { Mounted } from "../dom/testing";

/**
 * 媒体组测试共用的替身与生命周期（不是 *.test.ts，vitest 不会单独跑它）。
 *
 * 打桩只打边界：mediaDevices / MediaRecorder / Audio / fetch / ObjectURL。
 * 每个测试文件顶部调一次 installMediaTestEnv()，再把 mount 过的树交给 trackMount()。
 */

const mounts: Mounted[] = [];

export function trackMount(mounted: Mounted): Mounted {
  mounts.push(mounted);
  return mounted;
}

export function mediaNode(
  type: string,
  props: Record<string, unknown> = {},
  extra: Partial<Node> = {},
): Node {
  return { type, props, children: [], ...extra };
}

export function buttonByText(root: HTMLElement, text: string): HTMLButtonElement {
  const found = Array.from(root.querySelectorAll("button")).find(
    (button) => button.textContent?.trim() === text,
  );
  if (found === undefined) {
    throw new Error("没找到按钮: " + text);
  }
  return found;
}

/** MediaRecorder 替身：与浏览器状态机一致，stop 时先给数据再触发 onstop。 */
export class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = [];
  state: RecordingState = "inactive";
  mimeType: string;
  ondataavailable: ((event: BlobEvent) => void) | null = null;
  onstop: (() => void) | null = null;
  readonly stream: MediaStream;
  readonly options: MediaRecorderOptions | undefined;
  private readonly payload: Blob;

  constructor(stream: MediaStream, options?: MediaRecorderOptions) {
    this.stream = stream;
    this.options = options;
    this.mimeType =
      options?.mimeType ??
      (options?.videoBitsPerSecond === undefined ? "audio/webm" : "video/webm");
    this.payload = new Blob(["chunk"], { type: this.mimeType });
    FakeMediaRecorder.instances.push(this);
  }

  start(): void {
    this.state = "recording";
  }

  stop(): void {
    if (this.state === "inactive") {
      throw new Error("MediaRecorder 已经停了");
    }
    this.state = "inactive";
    this.ondataavailable?.({ data: this.payload } as BlobEvent);
    this.onstop?.();
  }

  pause(): void {
    if (this.state !== "recording") {
      throw new Error("没在录，不能暂停");
    }
    this.state = "paused";
  }

  resume(): void {
    if (this.state !== "paused") {
      throw new Error("没暂停，不能继续");
    }
    this.state = "recording";
  }
}

/** Audio 替身：只记下 data URL 与是否播过。 */
export class FakeAudio {
  static instances: FakeAudio[] = [];
  readonly src: string;
  readonly pause = vi.fn();
  readonly play = vi.fn(() => Promise.resolve());

  constructor(src: string) {
    this.src = src;
    FakeAudio.instances.push(this);
  }
}

export function stubMediaDevices(
  devices: readonly { deviceId: string; kind: string; label: string }[] = [],
) {
  const tracks = [{ stop: vi.fn() }];
  const stream = { getTracks: () => tracks } as unknown as MediaStream;
  const getUserMedia = vi.fn<(constraints: MediaStreamConstraints) => Promise<MediaStream>>();
  getUserMedia.mockResolvedValue(stream);
  Object.defineProperty(navigator, "mediaDevices", {
    value: {
      enumerateDevices: vi.fn(() => Promise.resolve(devices.map((device) => ({ ...device })))),
      getUserMedia,
    },
    configurable: true,
  });
  return { getUserMedia, stream, tracks };
}

export function stubUpload(mediaId: string) {
  const fetchMock = vi.fn(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ media_id: mediaId }),
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

export function stubObjectUrl() {
  const create = vi.fn(() => "blob:preview");
  const revoke = vi.fn();
  Object.defineProperty(URL, "createObjectURL", { value: create, configurable: true });
  Object.defineProperty(URL, "revokeObjectURL", { value: revoke, configurable: true });
  return { create, revoke };
}

/** 每个测试文件顶部调用一次。 */
export function installMediaTestEnv(): void {
  beforeEach(() => {
    FakeMediaRecorder.instances = [];
    FakeAudio.instances = [];
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
    // jsdom 的 play() 是"未实现"，换成 resolved promise，录制预览才可测。
    vi.spyOn(window.HTMLMediaElement.prototype, "play").mockImplementation(() => Promise.resolve());
  });
  afterEach(() => {
    for (const mounted of mounts.splice(0)) {
      mounted.destroy();
    }
    FakeMediaRecorder.instances = [];
    FakeAudio.instances = [];
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    Reflect.deleteProperty(navigator, "mediaDevices");
    Reflect.deleteProperty(URL, "createObjectURL");
    Reflect.deleteProperty(URL, "revokeObjectURL");
  });
}

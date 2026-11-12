// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Node } from "../../core/types";
import { mount, type Mounted } from "../testing";

/** wavesurfer 只在 waveform kind 里按需动态加载；测试里钉住它的生命周期。 */
const waveSurferMock = vi.hoisted(() => ({
  create: vi.fn<(options: Record<string, unknown>) => { destroy(): void }>(),
  destroy: vi.fn(),
}));

vi.mock("wavesurfer.js", () => ({
  default: { create: waveSurferMock.create },
}));

const mounts: Mounted[] = [];

function track(mounted: Mounted): Mounted {
  mounts.push(mounted);
  return mounted;
}

function node(type: string, props: Record<string, unknown> = {}, extra: Partial<Node> = {}): Node {
  return { type, props, children: [], ...extra };
}

function buttonByText(root: HTMLElement, text: string): HTMLButtonElement {
  const found = Array.from(root.querySelectorAll("button")).find(
    (button) => button.textContent?.trim() === text,
  );
  if (found === undefined) {
    throw new Error("没找到按钮: " + text);
  }
  return found;
}

/** MediaRecorder 替身：start / pause / resume / stop 与浏览器状态机一致。 */
class FakeMediaRecorder {
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

/** 音频替身：只记下 data URL 与是否播过。 */
class FakeAudio {
  static instances: FakeAudio[] = [];
  readonly src: string;
  readonly pause = vi.fn();
  readonly play = vi.fn(() => Promise.resolve());

  constructor(src: string) {
    this.src = src;
    FakeAudio.instances.push(this);
  }
}

interface StubbedDevices {
  getUserMedia: ReturnType<typeof vi.fn>;
  stream: MediaStream;
  tracks: { stop: ReturnType<typeof vi.fn> }[];
}

/** 假装浏览器里有这些设备；返回值给测试断言用。 */
function stubMediaDevices(
  devices: readonly { deviceId: string; kind: string; label: string }[] = [],
): StubbedDevices {
  const tracks = [{ stop: vi.fn() }];
  const stream = { getTracks: () => tracks } as unknown as MediaStream;
  const getUserMedia = vi.fn(() => Promise.resolve(stream));
  Object.defineProperty(navigator, "mediaDevices", {
    value: {
      enumerateDevices: vi.fn(async () => devices.map((device) => ({ ...device }))),
      getUserMedia,
    },
    configurable: true,
  });
  return { getUserMedia, stream, tracks };
}

function stubUpload(mediaId: string): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ media_id: mediaId }),
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function stubObjectUrl(): { create: ReturnType<typeof vi.fn>; revoke: ReturnType<typeof vi.fn> } {
  const create = vi.fn(() => "blob:preview");
  const revoke = vi.fn();
  Object.defineProperty(URL, "createObjectURL", { value: create, configurable: true });
  Object.defineProperty(URL, "revokeObjectURL", { value: revoke, configurable: true });
  return { create, revoke };
}

beforeEach(() => {
  FakeMediaRecorder.instances = [];
  FakeAudio.instances = [];
  vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
  // jsdom 的 play() 是"未实现"，替换成 resolved promise，录制预览才可测。
  vi.spyOn(window.HTMLMediaElement.prototype, "play").mockImplementation(() => Promise.resolve());
  waveSurferMock.create.mockReset();
  waveSurferMock.destroy.mockReset();
  waveSurferMock.create.mockImplementation(() => ({ destroy: waveSurferMock.destroy }));
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

describe("recorder", () => {
  it("按 v1 出录音条：dot + 提示，on_submit 落在 data-handler（events 优先，props 回退）", () => {
    const preferred = track(
      mount(node("recorder", { on_submit: "legacy" }, { events: { submit: "next" } })),
    );
    const root = preferred.root.querySelector(".omora-recorder");
    expect(root?.getAttribute("data-type")).toBe("recorder");
    const button = preferred.root.querySelector("button.omora-record");
    expect(button?.getAttribute("data-handler")).toBe("next");
    expect(button?.querySelector(".omora-record-dot")).not.toBeNull();
    expect(button?.textContent).toContain("录音");
    expect(preferred.root.querySelector(".omora-record-hint")?.textContent).toBe(
      "说出口，比打字快",
    );

    const fallback = track(mount(node("recorder", { on_submit: "legacy" })));
    expect(fallback.root.querySelector("button.omora-record")?.getAttribute("data-handler")).toBe(
      "legacy",
    );

    const bare = track(mount(node("recorder", {})));
    const disabled = bare.root.querySelector<HTMLButtonElement>("button.omora-record");
    expect(disabled?.disabled).toBe(true);
    expect(disabled?.hasAttribute("data-handler")).toBe(false);
  });

  it("点一下开始、再点一下停，把 base64 / mime / 时长交给 on_submit", async () => {
    const devices = stubMediaDevices([{ deviceId: "mic-1", kind: "audioinput", label: "麦克风" }]);
    const mounted = track(mount(node("recorder", {}, { events: { submit: "h-rec" } })));
    const button = mounted.root.querySelector<HTMLButtonElement>("button.omora-record");
    if (button === null) {
      throw new Error("录音按钮没画出来");
    }

    button.click();
    await vi.waitFor(() => {
      expect(button.classList.contains("is-recording")).toBe(true);
    });
    expect(button.textContent).toContain("录音中");
    expect(mounted.root.querySelector(".omora-record-hint")?.textContent).toBe("再点一下停");
    expect(devices.getUserMedia).toHaveBeenCalledTimes(1);
    expect(FakeMediaRecorder.instances).toHaveLength(1);

    button.click();
    await vi.waitFor(() => {
      expect(mounted.events).toHaveLength(1);
    });
    const event = mounted.events[0];
    expect(event?.handler).toBe("h-rec");
    expect(typeof event?.payload?.audio).toBe("string");
    expect(event?.payload?.audio).not.toBe("");
    expect(event?.payload?.mime).toBe("audio/webm");
    expect(typeof event?.payload?.seconds).toBe("number");
    expect(devices.tracks[0]?.stop).toHaveBeenCalled();
    expect(button.classList.contains("is-recording")).toBe(false);
  });

  it("还在录时卸载：停掉录音、释放麦克风，不再交回这段", async () => {
    const devices = stubMediaDevices([{ deviceId: "mic-1", kind: "audioinput", label: "麦克风" }]);
    const mounted = track(mount(node("recorder", {}, { events: { submit: "h-rec" } })));
    mounted.root.querySelector<HTMLButtonElement>("button.omora-record")?.click();
    await vi.waitFor(() => {
      expect(FakeMediaRecorder.instances).toHaveLength(1);
    });
    const recorder = FakeMediaRecorder.instances[0];

    mounted.destroy();
    await Promise.resolve();

    expect(recorder?.state).toBe("inactive");
    expect(devices.tracks[0]?.stop).toHaveBeenCalled();
    expect(mounted.events).toHaveLength(0);
  });
});

describe("audio", () => {
  it("按 media 出播放按钮；没有 media 就禁用", () => {
    const ready = track(mount(node("audio", { media: "m-1" })));
    const button = ready.root.querySelector<HTMLButtonElement>("button.omora-audio");
    expect(button?.getAttribute("data-type")).toBe("audio");
    expect(button?.getAttribute("data-handler")).toBe("m-1");
    expect(button?.getAttribute("aria-label")).toBe("播放");
    expect(button?.textContent).toBe("▶");
    expect(button?.disabled).toBe(false);

    const missing = track(mount(node("audio", {})));
    const disabled = missing.root.querySelector<HTMLButtonElement>("button.omora-audio");
    expect(disabled?.disabled).toBe(true);
    expect(disabled?.hasAttribute("data-handler")).toBe(false);
  });

  it("点播放：从 media 服务取字节，用 data URL 播", async () => {
    vi.stubGlobal("Audio", FakeAudio);
    const mounted = track(mount(node("audio", { media: "m-1" })));
    mounted.root.querySelector<HTMLButtonElement>("button.omora-audio")?.click();

    await vi.waitFor(() => {
      expect(FakeAudio.instances).toHaveLength(1);
    });
    const audio = FakeAudio.instances[0];
    expect(audio?.src.startsWith("data:")).toBe(true);
    expect(audio?.src.endsWith(";base64,")).toBe(true);
    expect(audio?.play).toHaveBeenCalledTimes(1);
  });

  it("同 id 更新原地换 media；卸载时停掉自己那条", async () => {
    vi.stubGlobal("Audio", FakeAudio);
    const mounted = track(mount(node("audio", { media: "m-1" }, { id: "a" })));
    const before = mounted.root.querySelector("button.omora-audio");
    mounted.render(node("audio", { media: "m-2" }, { id: "a" }));
    const after = mounted.root.querySelector<HTMLButtonElement>("button.omora-audio");
    expect(after).toBe(before);
    expect(after?.getAttribute("data-handler")).toBe("m-2");

    after?.click();
    await vi.waitFor(() => {
      expect(FakeAudio.instances).toHaveLength(1);
    });
    mounted.destroy();
    expect(FakeAudio.instances[0]?.pause).toHaveBeenCalledTimes(1);
  });
});

describe("audio_capture", () => {
  it("没有 mediaDevices：门禁关闭、按钮禁用、写清原因", () => {
    const mounted = track(mount(node("audio_capture", { on_submit: "h", upload_url: "/upload" })));
    const bar = mounted.root.querySelector<HTMLElement>(".omora-record-bar");
    const talk = mounted.root.querySelector<HTMLButtonElement>(".omora-talk");
    expect(bar?.getAttribute("data-type")).toBe("audio_capture");
    expect(bar?.dataset.gate).toBe("off");
    expect(bar?.dataset.phase).toBe("idle");
    expect(talk?.disabled).toBe(true);
    expect(mounted.root.querySelector(".omora-record-hint")?.textContent).toBe(
      "不支持媒体设备采集",
    );
    expect(mounted.root.querySelector(".omora-wave")?.getAttribute("data-live")).toBe("off");
    expect(mounted.root.querySelector<HTMLSelectElement>(".omora-device")?.hidden).toBe(true);
  });

  it("同 id 更新原地换 on_submit / 设备门禁，不重建捕捉条", async () => {
    stubMediaDevices([{ deviceId: "mic-1", kind: "audioinput", label: "麦克风" }]);
    const mounted = track(
      mount(node("audio_capture", { on_submit: "h-1", upload_url: "/upload" }, { id: "ac" })),
    );
    const bar = mounted.root.querySelector(".omora-record-bar");
    const talk = mounted.root.querySelector<HTMLButtonElement>(".omora-talk");
    await vi.waitFor(() => {
      expect(talk?.disabled).toBe(false);
    });
    expect(talk?.getAttribute("data-handler")).toBe("h-1");
    expect(bar?.getAttribute("data-gate")).toBe("on");

    mounted.render(
      node("audio_capture", { on_submit: "h-2", upload_url: "/upload" }, { id: "ac" }),
    );

    expect(mounted.root.querySelector(".omora-record-bar")).toBe(bar);
    expect(talk?.getAttribute("data-handler")).toBe("h-2");
  });

  it("多设备时出选择器，选中项写进开流约束", async () => {
    stubUpload("m-multi");
    const devices = stubMediaDevices([
      { deviceId: "mic-1", kind: "audioinput", label: "内置麦克风" },
      { deviceId: "mic-2", kind: "audioinput", label: "USB 麦克风" },
    ]);
    const mounted = track(mount(node("audio_capture", { on_submit: "h", upload_url: "/upload" })));
    const talk = mounted.root.querySelector<HTMLButtonElement>(".omora-talk");
    const select = mounted.root.querySelector<HTMLSelectElement>(".omora-device");
    if (talk === null || select === null) {
      throw new Error("捕捉条没画出来");
    }
    await vi.waitFor(() => {
      expect(talk.disabled).toBe(false);
    });
    expect(select.hidden).toBe(false);
    expect(Array.from(select.options).map((option) => option.textContent)).toEqual([
      "内置麦克风",
      "USB 麦克风",
    ]);

    select.value = "mic-2";
    select.dispatchEvent(new Event("change"));
    talk.click();
    await vi.waitFor(() => {
      expect(devices.getUserMedia).toHaveBeenCalledTimes(1);
    });
    expect(devices.getUserMedia.mock.calls[0]?.[0]).toEqual({
      audio: { deviceId: { ideal: "mic-2" } },
    });
  });

  it("开始 → 暂停 → 继续 → 停止，上传后把 media id 交给 on_submit", async () => {
    stubMediaDevices([{ deviceId: "mic-1", kind: "audioinput", label: "麦克风" }]);
    const fetchMock = stubUpload("m-audio");
    const mounted = track(
      mount(
        node("audio_capture", {
          on_submit: "h-audio",
          upload_url: "/upload",
          pausable: true,
        }),
      ),
    );
    const bar = mounted.root.querySelector<HTMLElement>(".omora-record-bar");
    const talk = mounted.root.querySelector<HTMLButtonElement>(".omora-talk");
    if (bar === null || talk === null) {
      throw new Error("捕捉条没画出来");
    }
    await vi.waitFor(() => {
      expect(talk.disabled).toBe(false);
    });
    expect(bar.dataset.gate).toBe("on");
    expect(mounted.root.querySelector(".omora-record-hint")?.textContent).toBe(
      "点一下开始，按住空格说",
    );

    talk.click();
    await vi.waitFor(() => {
      expect(bar.dataset.phase).toBe("recording");
    });
    expect(mounted.root.querySelector(".omora-talk-stop")).not.toBeNull();
    expect(mounted.root.querySelector(".omora-wave")?.getAttribute("data-live")).toBe("on");
    expect(FakeMediaRecorder.instances[0]?.options?.mimeType).toBe("audio/webm");

    buttonByText(mounted.root, "暂停").click();
    expect(bar.dataset.phase).toBe("paused");
    expect(mounted.root.querySelector(".omora-record-clock")?.textContent).toContain("已暂停");

    buttonByText(mounted.root, "继续").click();
    expect(bar.dataset.phase).toBe("recording");

    talk.click();
    await vi.waitFor(() => {
      expect(mounted.events).toHaveLength(1);
    });
    const event = mounted.events[0];
    expect(event?.handler).toBe("h-audio");
    expect(event?.payload?.media).toBe("m-audio");
    expect(event?.payload?.mime).toBe("audio/webm");
    expect(typeof event?.payload?.seconds).toBe("number");
    expect(fetchMock).toHaveBeenCalledWith("/upload", expect.objectContaining({ method: "POST" }));
    expect(bar.dataset.phase).toBe("idle");
  });

  it("autostart：设备就绪后自己开录", async () => {
    stubUpload("m-auto");
    stubMediaDevices([{ deviceId: "mic-1", kind: "audioinput", label: "麦克风" }]);
    const mounted = track(
      mount(
        node("audio_capture", {
          on_submit: "h",
          upload_url: "/upload",
          autostart: true,
        }),
      ),
    );
    const bar = mounted.root.querySelector<HTMLElement>(".omora-record-bar");
    await vi.waitFor(
      () => {
        expect(bar?.dataset.phase).toBe("recording");
      },
      { timeout: 2000 },
    );
  });

  it("max_seconds 到点自动停并提交", async () => {
    stubMediaDevices([{ deviceId: "mic-1", kind: "audioinput", label: "麦克风" }]);
    stubUpload("m-auto");
    const mounted = track(
      mount(
        node("audio_capture", {
          on_submit: "h-auto",
          upload_url: "/upload",
          max_seconds: 0.2,
        }),
      ),
    );
    const talk = mounted.root.querySelector<HTMLButtonElement>(".omora-talk");
    await vi.waitFor(() => {
      expect(talk?.disabled).toBe(false);
    });
    talk?.click();
    await vi.waitFor(
      () => {
        expect(mounted.events).toHaveLength(1);
      },
      { timeout: 3000 },
    );
    expect(mounted.events[0]?.payload?.media).toBe("m-auto");
  });

  it("还在录时卸载：停录并把这段提交出去（v1 的卸载即提交）", async () => {
    stubMediaDevices([{ deviceId: "mic-1", kind: "audioinput", label: "麦克风" }]);
    stubUpload("m-unload");
    const mounted = track(
      mount(node("audio_capture", { on_submit: "h-unload", upload_url: "/upload" })),
    );
    const talk = mounted.root.querySelector<HTMLButtonElement>(".omora-talk");
    const bar = mounted.root.querySelector<HTMLElement>(".omora-record-bar");
    await vi.waitFor(() => {
      expect(talk?.disabled).toBe(false);
    });
    talk?.click();
    await vi.waitFor(() => {
      expect(bar?.dataset.phase).toBe("recording");
    });

    mounted.destroy();
    await vi.waitFor(() => {
      expect(mounted.events).toHaveLength(1);
    });
    expect(mounted.events[0]?.handler).toBe("h-unload");
    expect(mounted.events[0]?.payload?.media).toBe("m-unload");
  });
});

describe("video_capture", () => {
  it("没有摄像头：门禁关闭、开录禁用、写清原因", () => {
    const mounted = track(mount(node("video_capture", { on_submit: "h", upload_url: "/upload" })));
    const bar = mounted.root.querySelector<HTMLElement>(".omora-video-bar");
    const start = buttonByText(mounted.root, "录视频");
    expect(bar?.getAttribute("data-type")).toBe("video_capture");
    expect(bar?.dataset.gate).toBe("off");
    expect(bar?.dataset.mode).toBe("idle");
    expect(start.disabled).toBe(true);
    expect(mounted.root.querySelector(".omora-record-hint")?.textContent).toBe(
      "不支持媒体设备采集",
    );
    expect(
      mounted.root.querySelector<HTMLVideoElement>('video[data-type="video-live"]')?.hidden,
    ).toBe(true);
  });

  it("同 id 更新原地换 on_submit，不重建捕捉条", async () => {
    stubMediaDevices([{ deviceId: "cam-1", kind: "videoinput", label: "摄像头" }]);
    const mounted = track(
      mount(node("video_capture", { on_submit: "h-1", upload_url: "/upload" }, { id: "vc" })),
    );
    const bar = mounted.root.querySelector(".omora-video-bar");
    const start = buttonByText(mounted.root, "录视频");
    await vi.waitFor(() => {
      expect(start.disabled).toBe(false);
    });
    expect(start.getAttribute("data-handler")).toBe("h-1");

    mounted.render(
      node("video_capture", { on_submit: "h-2", upload_url: "/upload" }, { id: "vc" }),
    );

    expect(mounted.root.querySelector(".omora-video-bar")).toBe(bar);
    expect(start.getAttribute("data-handler")).toBe("h-2");
  });

  it("录像：实时预览 → 暂停 → 继续 → 停止 → 上传拿回 media id", async () => {
    stubMediaDevices([{ deviceId: "cam-1", kind: "videoinput", label: "摄像头" }]);
    stubUpload("m-video");
    const objectUrl = stubObjectUrl();
    const mounted = track(
      mount(
        node("video_capture", {
          on_submit: "h-video",
          upload_url: "/upload",
          pausable: true,
        }),
      ),
    );
    const bar = mounted.root.querySelector<HTMLElement>(".omora-video-bar");
    const start = buttonByText(mounted.root, "录视频");
    await vi.waitFor(() => {
      expect(start.disabled).toBe(false);
    });
    expect(bar?.dataset.gate).toBe("on");

    start.click();
    await vi.waitFor(
      () => {
        expect(bar?.dataset.mode).toBe("recording");
      },
      { timeout: 2000 },
    );
    const live = mounted.root.querySelector<HTMLVideoElement>('video[data-type="video-live"]');
    expect(live?.hidden).toBe(false);
    expect(live?.srcObject).not.toBeNull();

    buttonByText(mounted.root, "暂停").click();
    expect(bar?.dataset.mode).toBe("paused");
    buttonByText(mounted.root, "继续").click();
    expect(bar?.dataset.mode).toBe("recording");

    const stop = mounted.root.querySelector<HTMLButtonElement>("button.is-recording");
    stop?.click();
    await vi.waitFor(() => {
      expect(mounted.events).toHaveLength(1);
    });
    const event = mounted.events[0];
    expect(event?.handler).toBe("h-video");
    expect(event?.payload?.media).toBe("m-video");
    expect(event?.payload?.mime).toBe("video/webm");
    expect(typeof event?.payload?.seconds).toBe("number");
    expect(objectUrl.create).toHaveBeenCalledTimes(1);
    expect(bar?.dataset.mode).toBe("idle");
  });

  it("还在录时卸载：停录并把这段提交出去", async () => {
    stubMediaDevices([{ deviceId: "cam-1", kind: "videoinput", label: "摄像头" }]);
    stubUpload("m-video-unload");
    const mounted = track(
      mount(node("video_capture", { on_submit: "h-unload", upload_url: "/upload" })),
    );
    const start = buttonByText(mounted.root, "录视频");
    const bar = mounted.root.querySelector<HTMLElement>(".omora-video-bar");
    await vi.waitFor(() => {
      expect(start.disabled).toBe(false);
    });
    start.click();
    await vi.waitFor(
      () => {
        expect(bar?.dataset.mode).toBe("recording");
      },
      { timeout: 2000 },
    );

    mounted.destroy();
    await vi.waitFor(() => {
      expect(mounted.events).toHaveLength(1);
    });
    expect(mounted.events[0]?.payload?.media).toBe("m-video-unload");
  });
});

describe("video", () => {
  it("有 src 出 video，保留 data-type / data-media 与播放属性", () => {
    const mounted = track(
      mount(node("video", { src: "http://127.0.0.1:1/media/v", media: "m-1" })),
    );
    const video = mounted.root.querySelector("video");
    expect(video?.getAttribute("data-type")).toBe("video");
    expect(video?.getAttribute("data-media")).toBe("m-1");
    expect(video?.getAttribute("src")).toBe("http://127.0.0.1:1/media/v");
    expect(video?.hasAttribute("controls")).toBe(true);
    expect(video?.getAttribute("preload")).toBe("metadata");
    expect(video?.hasAttribute("playsinline")).toBe(true);
  });

  it("没有 src 出 missing 文案；同 id 原地换成 video", () => {
    const mounted = track(mount(node("video", { media: "m-1" }, { id: "v" })));
    const wrapper = mounted.root.firstElementChild;
    const missing = mounted.root.querySelector(".omora-video-missing");
    expect(missing?.getAttribute("data-type")).toBe("video");
    expect(missing?.getAttribute("data-media")).toBe("m-1");
    expect(missing?.textContent).toBe("媒体通道未就绪");

    mounted.render(node("video", { src: "http://x/v.mp4", media: "m-2" }, { id: "v" }));

    expect(mounted.root.firstElementChild).toBe(wrapper);
    expect(mounted.root.querySelector(".omora-video-missing")).toBeNull();
    const video = mounted.root.querySelector("video");
    expect(video?.getAttribute("data-media")).toBe("m-2");
    expect(video?.getAttribute("src")).toBe("http://x/v.mp4");
  });

  it("卸载后元素被移除", () => {
    const mounted = mount(node("video", { src: "http://x/v.mp4" }));
    expect(mounted.root.querySelector("video")).not.toBeNull();
    mounted.destroy();
    expect(mounted.root.querySelector("video")).toBeNull();
  });
});

describe("waveform", () => {
  it("没有 src 只出空盒子，不去加载 wavesurfer", () => {
    const mounted = track(mount(node("waveform", {})));
    const el = mounted.root.querySelector(".omora-waveform");
    expect(el?.getAttribute("data-type")).toBe("waveform");
    expect(el?.getAttribute("data-src")).toBe("");
    expect(waveSurferMock.create).not.toHaveBeenCalled();
  });

  it("有 src 时按 v1 参数建 wavesurfer，卸载时销毁", async () => {
    const mounted = track(mount(node("waveform", { src: "http://127.0.0.1:1/media/a" })));
    const el = mounted.root.querySelector(".omora-waveform");
    await vi.waitFor(() => {
      expect(waveSurferMock.create).toHaveBeenCalledTimes(1);
    });
    const options = waveSurferMock.create.mock.calls[0]?.[0];
    expect(options?.container).toBe(el);
    expect(options?.url).toBe("http://127.0.0.1:1/media/a");
    expect(options?.interact).toBe(false);
    expect(options?.height).toBe(32);

    mounted.destroy();
    expect(waveSurferMock.destroy).toHaveBeenCalledTimes(1);
  });

  it("同 src 更新不重建；src 变了销毁旧的再建新的", async () => {
    const first = node("waveform", { src: "http://x/a" }, { id: "w" });
    const mounted = track(mount(first));
    const el = mounted.root.querySelector(".omora-waveform");
    await vi.waitFor(() => {
      expect(waveSurferMock.create).toHaveBeenCalledTimes(1);
    });

    mounted.render(node("waveform", { src: "http://x/a" }, { id: "w" }));
    expect(waveSurferMock.create).toHaveBeenCalledTimes(1);

    mounted.render(node("waveform", { src: "http://x/b" }, { id: "w" }));
    await vi.waitFor(() => {
      expect(waveSurferMock.create).toHaveBeenCalledTimes(2);
    });
    expect(mounted.root.querySelector(".omora-waveform")).toBe(el);
    expect(el?.getAttribute("data-src")).toBe("http://x/b");
    expect(waveSurferMock.destroy).toHaveBeenCalledTimes(1);
    expect(waveSurferMock.create.mock.calls[1]?.[0]?.url).toBe("http://x/b");
  });
});

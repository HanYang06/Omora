// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "../testing";
import {
  buttonByText,
  FakeMediaRecorder,
  mediaNode,
  stubMediaDevices,
  stubUpload,
  trackMount,
  installMediaTestEnv,
} from "./media_test_support";

/** legacy 的实时波形来自 wavesurfer + record 插件；测试里用替身钉住接线与生命周期。 */
const micMock = vi.hoisted(() => {
  type Listener = (payload?: unknown) => void;

  class FakeRecordPlugin {
    readonly options: Record<string, unknown>;
    active = false;
    paused = false;
    duration = 1000;
    lastStart: { deviceId?: { ideal: string } } | undefined;
    private readonly listeners = new Map<string, Listener>();

    constructor(options: Record<string, unknown>) {
      this.options = options;
    }

    on(event: string, listener: Listener): void {
      this.listeners.set(event, listener);
    }

    startRecording(options?: { deviceId?: { ideal: string } }): Promise<void> {
      this.lastStart = options;
      this.active = true;
      return Promise.resolve();
    }

    stopRecording(): void {
      if (!this.active) {
        return;
      }
      this.active = false;
      this.emit("record-end", new Blob(["chunk"], { type: "audio/webm" }));
    }

    pauseRecording(): void {
      this.paused = true;
      this.emit("record-pause");
    }

    resumeRecording(): void {
      this.paused = false;
      this.emit("record-resume");
    }

    isActive(): boolean {
      return this.active;
    }

    getDuration(): number {
      return this.duration;
    }

    progress(millis: number): void {
      this.emit("record-progress", millis);
    }

    private emit(event: string, payload?: unknown): void {
      this.listeners.get(event)?.(payload);
    }
  }

  class FakeWave {
    plugin: unknown = null;
    destroyed = false;

    constructor(readonly options: Record<string, unknown>) {}

    registerPlugin(plugin: unknown): unknown {
      this.plugin = plugin;
      return plugin;
    }

    destroy(): void {
      this.destroyed = true;
    }
  }

  const state = {
    plugins: [] as FakeRecordPlugin[],
    waves: [] as FakeWave[],
    waveOptions: [] as Record<string, unknown>[],
    recordOptions: [] as Record<string, unknown>[],
    createThrows: false,
  };
  const waveModule = {
    create(options: Record<string, unknown>) {
      if (state.createThrows) {
        throw new Error("没有 WebAudio");
      }
      const wave = new FakeWave(options);
      state.waves.push(wave);
      state.waveOptions.push(options);
      return wave;
    },
  };
  const recordModule = {
    create(options: Record<string, unknown>) {
      const plugin = new FakeRecordPlugin(options);
      state.plugins.push(plugin);
      state.recordOptions.push(options);
      return plugin;
    },
  };
  return { state, waveModule, recordModule };
});

vi.mock("wavesurfer.js", () => ({ default: micMock.waveModule }));
vi.mock("wavesurfer.js/dist/plugins/record.js", () => ({ default: micMock.recordModule }));

installMediaTestEnv();

beforeEach(() => {
  micMock.state.plugins.length = 0;
  micMock.state.waves.length = 0;
  micMock.state.waveOptions.length = 0;
  micMock.state.recordOptions.length = 0;
  micMock.state.createThrows = false;
});

function captureBar(mounted: ReturnType<typeof mount>) {
  const bar = mounted.root.querySelector<HTMLElement>(".omora-record-bar");
  const talk = mounted.root.querySelector<HTMLButtonElement>(".omora-talk");
  const wave = mounted.root.querySelector<HTMLElement>(".omora-wave");
  if (bar === null || talk === null || wave === null) {
    throw new Error("捕捉条没画出来");
  }
  return { bar, talk, wave };
}

function pluginAt(index = 0) {
  const plugin = micMock.state.plugins[index];
  if (plugin === undefined) {
    throw new Error("record 插件还没建出来");
  }
  return plugin;
}

async function waitForRecording(bar: HTMLElement, plugin: ReturnType<typeof pluginAt>) {
  await vi.waitFor(() => {
    expect(bar.dataset.phase).toBe("recording");
  });
  expect(plugin.active).toBe(true);
}

describe("audio_capture", () => {
  it("没有 mediaDevices：门禁关闭、按钮禁用、写清原因", () => {
    const mounted = trackMount(
      mount(mediaNode("audio_capture", { on_submit: "h", upload_url: "/upload" })),
    );
    const { bar, talk, wave } = captureBar(mounted);
    expect(bar.getAttribute("data-type")).toBe("audio_capture");
    expect(bar.dataset.gate).toBe("off");
    expect(bar.dataset.phase).toBe("idle");
    expect(talk.disabled).toBe(true);
    expect(mounted.root.querySelector(".omora-record-hint")?.textContent).toBe(
      "不支持媒体设备采集",
    );
    expect(wave.dataset.live).toBe("off");
    expect(mounted.root.querySelector<HTMLSelectElement>(".omora-device")?.hidden).toBe(true);
  });

  it("用 legacy 同款 wavesurfer record 插件画实时波形，参数对齐", async () => {
    stubMediaDevices([{ deviceId: "mic-1", kind: "audioinput", label: "麦克风" }]);
    const mounted = trackMount(
      mount(mediaNode("audio_capture", { on_submit: "h", upload_url: "/upload" })),
    );
    const { bar, talk, wave } = captureBar(mounted);
    await vi.waitFor(() => {
      expect(talk.disabled).toBe(false);
    });
    expect(bar.dataset.gate).toBe("on");
    await vi.waitFor(() => {
      expect(micMock.state.waves).toHaveLength(1);
    });

    expect(micMock.state.waveOptions[0]?.container).toBe(wave);
    expect(micMock.state.recordOptions[0]).toMatchObject({
      mimeType: "audio/webm",
      audioBitsPerSecond: 128_000,
      scrollingWaveform: true,
      scrollingWaveformWindow: 10,
      renderRecordedAudio: false,
    });
    expect(micMock.state.waves[0]?.plugin).toBe(pluginAt());
  });

  it("开始 → 暂停 → 继续 → 停止，上传后把 media id 交给 on_submit", async () => {
    stubMediaDevices([{ deviceId: "mic-1", kind: "audioinput", label: "麦克风" }]);
    const fetchMock = stubUpload("m-audio");
    const mounted = trackMount(
      mount(
        mediaNode("audio_capture", {
          on_submit: "h-audio",
          upload_url: "/upload",
          pausable: true,
        }),
      ),
    );
    const { bar, talk } = captureBar(mounted);
    await vi.waitFor(() => {
      expect(talk.disabled).toBe(false);
    });
    await vi.waitFor(() => {
      expect(micMock.state.plugins).toHaveLength(1);
    });
    const plugin = pluginAt();

    talk.click();
    await waitForRecording(bar, plugin);
    expect(bar.dataset.gate).toBe("on");
    expect(mounted.root.querySelector(".omora-record-hint")?.textContent).toBe("点一下停");

    plugin.progress(1500);
    expect(mounted.root.querySelector(".omora-record-clock")?.textContent).toContain("0:01");

    buttonByText(mounted.root, "暂停").click();
    expect(bar.dataset.phase).toBe("paused");
    expect(plugin.paused).toBe(true);
    expect(mounted.root.querySelector(".omora-record-clock")?.textContent).toContain("已暂停");
    buttonByText(mounted.root, "继续").click();
    expect(bar.dataset.phase).toBe("recording");
    expect(plugin.paused).toBe(false);

    talk.click();
    await vi.waitFor(() => {
      expect(mounted.events).toHaveLength(1);
    });
    const event = mounted.events[0];
    expect(event?.handler).toBe("h-audio");
    expect(event?.payload?.media).toBe("m-audio");
    expect(event?.payload?.mime).toBe("audio/webm");
    expect(event?.payload?.seconds).toBe(1);
    expect(fetchMock).toHaveBeenCalledWith("/upload", expect.objectContaining({ method: "POST" }));
    expect(bar.dataset.phase).toBe("idle");
  });

  it("多设备时出选择器，选中项写进 startRecording 约束", async () => {
    stubUpload("m-multi");
    stubMediaDevices([
      { deviceId: "mic-1", kind: "audioinput", label: "内置麦克风" },
      { deviceId: "mic-2", kind: "audioinput", label: "USB 麦克风" },
    ]);
    const mounted = trackMount(
      mount(mediaNode("audio_capture", { on_submit: "h", upload_url: "/upload" })),
    );
    const { talk } = captureBar(mounted);
    await vi.waitFor(() => {
      expect(talk.disabled).toBe(false);
    });
    const select = mounted.root.querySelector<HTMLSelectElement>(".omora-device");
    if (select === null) {
      throw new Error("设备选择器没画出来");
    }
    expect(select.hidden).toBe(false);
    expect(Array.from(select.options).map((option) => option.textContent)).toEqual([
      "内置麦克风",
      "USB 麦克风",
    ]);
    select.value = "mic-2";
    select.dispatchEvent(new Event("change"));

    talk.click();
    await vi.waitFor(() => {
      expect(micMock.state.plugins[0]?.lastStart).toEqual({
        deviceId: { ideal: "mic-2" },
      });
    });
  });

  it("max_seconds 到点自动停并提交", async () => {
    stubMediaDevices([{ deviceId: "mic-1", kind: "audioinput", label: "麦克风" }]);
    stubUpload("m-auto");
    const mounted = trackMount(
      mount(
        mediaNode("audio_capture", {
          on_submit: "h-auto",
          upload_url: "/upload",
          max_seconds: 1,
        }),
      ),
    );
    const { bar, talk } = captureBar(mounted);
    await vi.waitFor(() => {
      expect(talk.disabled).toBe(false);
    });
    await vi.waitFor(() => {
      expect(micMock.state.plugins).toHaveLength(1);
    });
    talk.click();
    await waitForRecording(bar, pluginAt());

    pluginAt().progress(1000);
    await vi.waitFor(() => {
      expect(mounted.events).toHaveLength(1);
    });
    expect(mounted.events[0]?.payload?.media).toBe("m-auto");
  });

  it("还在录时卸载：停录并把这段提交出去（legacy 的卸载即提交）", async () => {
    stubMediaDevices([{ deviceId: "mic-1", kind: "audioinput", label: "麦克风" }]);
    stubUpload("m-unload");
    const mounted = trackMount(
      mount(mediaNode("audio_capture", { on_submit: "h-unload", upload_url: "/upload" })),
    );
    const { bar, talk } = captureBar(mounted);
    await vi.waitFor(() => {
      expect(talk.disabled).toBe(false);
    });
    await vi.waitFor(() => {
      expect(micMock.state.plugins).toHaveLength(1);
    });
    talk.click();
    await waitForRecording(bar, pluginAt());

    mounted.destroy();
    await vi.waitFor(() => {
      expect(mounted.events).toHaveLength(1);
    });
    expect(mounted.events[0]?.handler).toBe("h-unload");
    expect(mounted.events[0]?.payload?.media).toBe("m-unload");
  });

  it("波形库不可用：退回 MediaRecorder，录制 / 上传照常", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    micMock.state.createThrows = true;
    stubMediaDevices([{ deviceId: "mic-1", kind: "audioinput", label: "麦克风" }]);
    stubUpload("m-fallback");
    const mounted = trackMount(
      mount(mediaNode("audio_capture", { on_submit: "h-fallback", upload_url: "/upload" })),
    );
    const { bar, talk } = captureBar(mounted);
    await vi.waitFor(() => {
      expect(talk.disabled).toBe(false);
    });
    expect(errorSpy).toHaveBeenCalledWith(
      "[omora] 实时波形不可用，退回 MediaRecorder:",
      expect.anything(),
    );

    talk.click();
    await vi.waitFor(() => {
      expect(bar.dataset.phase).toBe("recording");
    });
    expect(FakeMediaRecorder.instances).toHaveLength(1);

    talk.click();
    await vi.waitFor(() => {
      expect(mounted.events).toHaveLength(1);
    });
    expect(mounted.events[0]?.payload?.media).toBe("m-fallback");
  });

  it("同 id 更新原地换 on_submit，不重建捕捉条", async () => {
    stubMediaDevices([{ deviceId: "mic-1", kind: "audioinput", label: "麦克风" }]);
    const mounted = trackMount(
      mount(mediaNode("audio_capture", { on_submit: "h-1", upload_url: "/upload" }, { id: "ac" })),
    );
    const { bar, talk } = captureBar(mounted);
    await vi.waitFor(() => {
      expect(talk.disabled).toBe(false);
    });
    expect(talk.getAttribute("data-handler")).toBe("h-1");

    mounted.render(
      mediaNode("audio_capture", { on_submit: "h-2", upload_url: "/upload" }, { id: "ac" }),
    );
    expect(mounted.root.querySelector(".omora-record-bar")).toBe(bar);
    expect(talk.getAttribute("data-handler")).toBe("h-2");
  });
});

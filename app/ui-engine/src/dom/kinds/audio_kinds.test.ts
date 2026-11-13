// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "../testing";
import {
  FakeAudio,
  mediaNode,
  stubMediaDevices,
  trackMount,
  installMediaTestEnv,
} from "./media_test_support";

/** waveform kind 按需动态加载 wavesurfer；这里钉住生命周期。 */
const waveSurferMock = vi.hoisted(() => ({
  create: vi.fn<(options: Record<string, unknown>) => { destroy(): void }>(),
  destroy: vi.fn(),
}));

vi.mock("wavesurfer.js", () => ({
  default: { create: waveSurferMock.create },
}));

installMediaTestEnv();

beforeEach(() => {
  waveSurferMock.create.mockReset();
  waveSurferMock.destroy.mockReset();
  waveSurferMock.create.mockImplementation(() => ({ destroy: waveSurferMock.destroy }));
});

describe("recorder", () => {
  it("按 legacy 出录音条：dot + 提示，on_submit 落在 data-handler（events 优先，props 回退）", () => {
    const preferred = trackMount(
      mount(mediaNode("recorder", { on_submit: "legacy" }, { events: { submit: "next" } })),
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

    const fallback = trackMount(mount(mediaNode("recorder", { on_submit: "legacy" })));
    expect(fallback.root.querySelector("button.omora-record")?.getAttribute("data-handler")).toBe(
      "legacy",
    );

    const bare = trackMount(mount(mediaNode("recorder", {})));
    const disabled = bare.root.querySelector<HTMLButtonElement>("button.omora-record");
    expect(disabled?.disabled).toBe(true);
    expect(disabled?.hasAttribute("data-handler")).toBe(false);
  });

  it("点一下开始、再点一下停，把 base64 / mime / 时长交给 on_submit", async () => {
    const devices = stubMediaDevices([{ deviceId: "mic-1", kind: "audioinput", label: "麦克风" }]);
    const mounted = trackMount(mount(mediaNode("recorder", {}, { events: { submit: "h-rec" } })));
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
    const mounted = trackMount(mount(mediaNode("recorder", {}, { events: { submit: "h-rec" } })));
    mounted.root.querySelector<HTMLButtonElement>("button.omora-record")?.click();
    await vi.waitFor(() => {
      expect(devices.getUserMedia).toHaveBeenCalledTimes(1);
    });

    mounted.destroy();
    await Promise.resolve();

    expect(devices.tracks[0]?.stop).toHaveBeenCalled();
    expect(mounted.events).toHaveLength(0);
  });
});

describe("audio", () => {
  it("按 media 出播放按钮；没有 media 就禁用", () => {
    const ready = trackMount(mount(mediaNode("audio", { media: "m-1" })));
    const button = ready.root.querySelector<HTMLButtonElement>("button.omora-audio");
    expect(button?.getAttribute("data-type")).toBe("audio");
    expect(button?.getAttribute("data-handler")).toBe("m-1");
    expect(button?.getAttribute("aria-label")).toBe("播放");
    expect(button?.textContent).toBe("▶");
    expect(button?.disabled).toBe(false);

    const missing = trackMount(mount(mediaNode("audio", {})));
    const disabled = missing.root.querySelector<HTMLButtonElement>("button.omora-audio");
    expect(disabled?.disabled).toBe(true);
    expect(disabled?.hasAttribute("data-handler")).toBe(false);
  });

  it("点播放：从 media 服务取字节，用 data URL 播", async () => {
    vi.stubGlobal("Audio", FakeAudio);
    const mounted = trackMount(mount(mediaNode("audio", { media: "m-1" })));
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
    const mounted = trackMount(mount(mediaNode("audio", { media: "m-1" }, { id: "a" })));
    const before = mounted.root.querySelector("button.omora-audio");
    mounted.render(mediaNode("audio", { media: "m-2" }, { id: "a" }));
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

describe("waveform", () => {
  it("没有 src 只出空盒子，不去加载 wavesurfer", () => {
    const mounted = trackMount(mount(mediaNode("waveform", {})));
    const el = mounted.root.querySelector(".omora-waveform");
    expect(el?.getAttribute("data-type")).toBe("waveform");
    expect(el?.getAttribute("data-src")).toBe("");
    expect(waveSurferMock.create).not.toHaveBeenCalled();
  });

  it("有 src 时按 legacy 参数建 wavesurfer，卸载时销毁", async () => {
    const mounted = trackMount(mount(mediaNode("waveform", { src: "http://127.0.0.1:1/media/a" })));
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
    const mounted = trackMount(mount(mediaNode("waveform", { src: "http://x/a" }, { id: "w" })));
    const el = mounted.root.querySelector(".omora-waveform");
    await vi.waitFor(() => {
      expect(waveSurferMock.create).toHaveBeenCalledTimes(1);
    });

    mounted.render(mediaNode("waveform", { src: "http://x/a" }, { id: "w" }));
    expect(waveSurferMock.create).toHaveBeenCalledTimes(1);

    mounted.render(mediaNode("waveform", { src: "http://x/b" }, { id: "w" }));
    await vi.waitFor(() => {
      expect(waveSurferMock.create).toHaveBeenCalledTimes(2);
    });
    expect(mounted.root.querySelector(".omora-waveform")).toBe(el);
    expect(el?.getAttribute("data-src")).toBe("http://x/b");
    expect(waveSurferMock.destroy).toHaveBeenCalledTimes(1);
    expect(waveSurferMock.create.mock.calls[1]?.[0]?.url).toBe("http://x/b");
  });
});

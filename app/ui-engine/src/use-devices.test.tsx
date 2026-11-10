import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { AudioCapture } from "./audio-capture";

/**
 * 回归：真实渲染里没人给组件传 devices，早先这里直接当"不支持"，
 * 于是桌面壳和浏览器里永远是"不支持媒体设备采集"。
 */
function stubMediaDevices(value: unknown): void {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { mediaDevices: value },
  });
}

afterEach(() => {
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: {} });
});

describe("设备源回落", () => {
  it("没传 devices 时用 navigator.mediaDevices，而不是判成不支持", () => {
    stubMediaDevices({ enumerateDevices: async () => [] });
    const node = { type: "audio_capture", props: { on_submit: "h" }, children: [] };

    const html = renderToString(<AudioCapture node={node} onEvent={() => {}} />);

    expect(html).toContain("正在检测设备");
    expect(html).not.toContain("不支持媒体设备采集");
  });

  it("浏览器连 mediaDevices 都没有时才说不支持", () => {
    stubMediaDevices(undefined);
    const node = { type: "audio_capture", props: { on_submit: "h" }, children: [] };

    const html = renderToString(<AudioCapture node={node} onEvent={() => {}} />);

    expect(html).toContain("不支持媒体设备采集");
  });
});

// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { mount } from "../testing";
import {
  buttonByText,
  mediaNode,
  stubMediaDevices,
  stubObjectUrl,
  stubUpload,
  trackMount,
  installMediaTestEnv,
} from "./media_test_support";

installMediaTestEnv();

function videoBar(mounted: ReturnType<typeof mount>) {
  const bar = mounted.root.querySelector<HTMLElement>(".omora-video-bar");
  if (bar === null) {
    throw new Error("视频捕捉条没画出来");
  }
  return bar;
}

async function waitForMode(bar: HTMLElement, mode: string): Promise<void> {
  await vi.waitFor(
    () => {
      expect(bar.dataset.mode).toBe(mode);
    },
    { timeout: 2000 },
  );
}

describe("video_capture", () => {
  it("没有摄像头：门禁关闭、开录禁用、写清原因", () => {
    const mounted = trackMount(
      mount(mediaNode("video_capture", { on_submit: "h", upload_url: "/upload" })),
    );
    const bar = videoBar(mounted);
    const start = buttonByText(mounted.root, "录视频");
    expect(bar.getAttribute("data-type")).toBe("video_capture");
    expect(bar.dataset.gate).toBe("off");
    expect(bar.dataset.mode).toBe("idle");
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
    const mounted = trackMount(
      mount(mediaNode("video_capture", { on_submit: "h-1", upload_url: "/upload" }, { id: "vc" })),
    );
    const bar = videoBar(mounted);
    const start = buttonByText(mounted.root, "录视频");
    await vi.waitFor(() => {
      expect(start.disabled).toBe(false);
    });
    expect(start.getAttribute("data-handler")).toBe("h-1");

    mounted.render(
      mediaNode("video_capture", { on_submit: "h-2", upload_url: "/upload" }, { id: "vc" }),
    );

    expect(mounted.root.querySelector(".omora-video-bar")).toBe(bar);
    expect(start.getAttribute("data-handler")).toBe("h-2");
  });

  it("录像：实时预览 → 暂停 → 继续 → 停止 → 上传拿回 media id", async () => {
    stubMediaDevices([{ deviceId: "cam-1", kind: "videoinput", label: "摄像头" }]);
    stubUpload("m-video");
    const objectUrl = stubObjectUrl();
    const mounted = trackMount(
      mount(
        mediaNode("video_capture", {
          on_submit: "h-video",
          upload_url: "/upload",
          pausable: true,
        }),
      ),
    );
    const bar = videoBar(mounted);
    const start = buttonByText(mounted.root, "录视频");
    await vi.waitFor(() => {
      expect(start.disabled).toBe(false);
    });
    expect(bar.dataset.gate).toBe("on");

    start.click();
    await waitForMode(bar, "recording");
    const live = mounted.root.querySelector<HTMLVideoElement>('video[data-type="video-live"]');
    expect(live?.hidden).toBe(false);
    expect(live?.srcObject).not.toBeNull();

    buttonByText(mounted.root, "暂停").click();
    expect(bar.dataset.mode).toBe("paused");
    buttonByText(mounted.root, "继续").click();
    expect(bar.dataset.mode).toBe("recording");

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
    expect(bar.dataset.mode).toBe("idle");
    expect(
      mounted.root.querySelector<HTMLVideoElement>(".omora-video-bar video:not([data-type])")
        ?.hidden,
    ).toBe(true);
  });

  it("还在录时卸载：停录并把这段提交出去", async () => {
    stubMediaDevices([{ deviceId: "cam-1", kind: "videoinput", label: "摄像头" }]);
    stubUpload("m-video-unload");
    const mounted = trackMount(
      mount(mediaNode("video_capture", { on_submit: "h-unload", upload_url: "/upload" })),
    );
    const bar = videoBar(mounted);
    const start = buttonByText(mounted.root, "录视频");
    await vi.waitFor(() => {
      expect(start.disabled).toBe(false);
    });
    start.click();
    await waitForMode(bar, "recording");

    mounted.destroy();
    await vi.waitFor(() => {
      expect(mounted.events).toHaveLength(1);
    });
    expect(mounted.events[0]?.handler).toBe("h-unload");
    expect(mounted.events[0]?.payload?.media).toBe("m-video-unload");
  });
});

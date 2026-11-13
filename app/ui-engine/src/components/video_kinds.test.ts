// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { mount } from "./testing";
import { mediaNode, trackMount, installMediaTestEnv } from "./media_test_support";

installMediaTestEnv();

describe("video", () => {
  it("有 src 出 video，保留 data-type / data-media 与播放属性", () => {
    const mounted = trackMount(
      mount(mediaNode("video", { src: "http://127.0.0.1:1/media/v", media: "m-1" })),
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
    const mounted = trackMount(mount(mediaNode("video", { media: "m-1" }, { id: "v" })));
    const wrapper = mounted.root.firstElementChild;
    const missing = mounted.root.querySelector(".omora-video-missing");
    expect(missing?.getAttribute("data-type")).toBe("video");
    expect(missing?.getAttribute("data-media")).toBe("m-1");
    expect(missing?.textContent).toBe("媒体通道未就绪");

    mounted.render(mediaNode("video", { src: "http://x/v.mp4", media: "m-2" }, { id: "v" }));

    expect(mounted.root.firstElementChild).toBe(wrapper);
    expect(mounted.root.querySelector(".omora-video-missing")).toBeNull();
    const video = mounted.root.querySelector("video");
    expect(video?.getAttribute("data-media")).toBe("m-2");
    expect(video?.getAttribute("src")).toBe("http://x/v.mp4");
  });

  it("卸载后元素被移除", () => {
    const mounted = mount(mediaNode("video", { src: "http://x/v.mp4" }));
    expect(mounted.root.querySelector("video")).not.toBeNull();
    mounted.destroy();
    expect(mounted.root.querySelector("video")).toBeNull();
  });
});

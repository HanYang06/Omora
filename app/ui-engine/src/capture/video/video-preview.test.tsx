import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LiveVideo } from "./live-video";
import { QUALITY_BITRATE } from "./video-quality";

/**
 * 回归：录制时只挂 srcObject 不会开始播放，画面就是黑的。
 * video 必须 autoPlay + muted + playsInline，才有实时预览。
 */
describe("录制预览", () => {
  it("视频元素自己开播，且静音（静音才允许自动播）", () => {
    const html = renderToString(<LiveVideo stream={null} />);

    const lower = html.toLowerCase();
    expect(lower, html).toContain("autoplay");
    expect(lower, html).toContain("muted");
    expect(lower, html).toContain("playsinline");
    expect(html).toContain('data-type="video-live"');
  });
});
describe("录制参数", () => {
  /**
   * 索引访问在 noUncheckedIndexedAccess 下是 number | undefined。
   * 缺档本身就是 bug，这里显式取出来：缺了扔错，测试信息直接指出是哪一档。
   */
  function bitrate(quality: string): number {
    const value = QUALITY_BITRATE[quality];
    if (value === undefined) {
      throw new Error(`缺少 ${quality} 的码率`);
    }
    return value;
  }

  it("三档都有码率，而且分辨率越高码率越大", () => {
    expect(Object.keys(QUALITY_BITRATE).sort()).toEqual(["1080p", "480p", "720p"]);
    expect(bitrate("480p")).toBeLessThan(bitrate("720p"));
    expect(bitrate("720p")).toBeLessThan(bitrate("1080p"));
  });
});

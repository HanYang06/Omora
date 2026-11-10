import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { renderTree } from "./renderer";
import { wavePaths, waveformBars } from "./waveform";

/** 一条静态波形节点。 */
function waveform(peaks: unknown, seconds: unknown): ReturnType<typeof renderTree> {
  return renderTree([
    {
      type: "waveform",
      props: { peaks, seconds },
      children: [],
    },
  ]);
}

describe("波形路径", () => {
  it("以中线镜像：峰值 100 撑满上下，峰值 0 落在中线上", () => {
    const quiet = wavePaths([0]);
    const loud = wavePaths([100]);

    expect(quiet.line).toContain("0.50,50.00");
    expect(quiet.area).toContain("0.50,50.00");
    expect(loud.line).toContain("0.50,0.00");
    expect(loud.area).toContain("0.50,100.00");
  });

  it("面积是闭合的、折线是开口的：同一条峰值不会画成直方图", () => {
    const { area, line } = wavePaths([10, 90, 30]);

    expect(area.startsWith("M")).toBe(true);
    expect(area.endsWith(" Z")).toBe(true);
    expect(line.startsWith("M")).toBe(true);
    expect(line).not.toContain("Z");
  });

  it("没有峰值就两条路径都不给，别画出半截线", () => {
    expect(wavePaths([])).toEqual({ area: "", line: "" });
  });
});

describe("波形数据的清洗", () => {
  it("越界和非数字的峰值被夹回 0–100 / 丢掉", () => {
    expect(waveformBars([150, -5, "x", 42.6])).toEqual([100, 0, 43]);
  });

  it("不是数组就给空，不崩", () => {
    expect(waveformBars(undefined)).toEqual([]);
    expect(waveformBars("1,2,3")).toEqual([]);
  });
});

describe("静态波形节点", () => {
  it("按峰值画出面积与折线，时长用 M:SS 标在旁边", () => {
    const html = renderToString(<>{waveform([0, 50, 100], 65)}</>);

    expect(html).toContain('data-type="waveform"');
    expect(html).toContain('data-bars="3"');
    expect(html).toContain("omora-wave-area");
    expect(html).toContain("omora-wave-line");
    expect(html).toContain("1:05");
  });

  it("没有峰值就一根线都不画，但时长照样标出来", () => {
    const html = renderToString(<>{waveform([], 3)}</>);

    expect(html).toContain('data-bars="0"');
    expect(html).not.toContain("omora-wave-line");
    expect(html).toContain("0:03");
  });

  it("缺 seconds 时按 0:00 标，而不是空白", () => {
    const html = renderToString(<>{waveform([30], undefined)}</>);

    expect(html).toContain('data-bars="1"');
    expect(html).toContain("0:00");
  });
});

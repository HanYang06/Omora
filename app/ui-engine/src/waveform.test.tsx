import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { renderTree } from "./renderer";

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

describe("静态波形", () => {
  it("每根柱子按峰值给高度，时长用 M:SS 标在旁边", () => {
    const html = renderToString(<>{waveform([0, 50, 100], 65)}</>);

    expect(html).toContain('data-type="waveform"');
    expect(html).toContain('data-bars="3"');
    expect(html).toContain("height:0%");
    expect(html).toContain("height:50%");
    expect(html).toContain("height:100%");
    expect(html).toContain("1:05");
  });

  it("越界和非数字的峰值被夹回 0–100 / 丢掉，不把柱子画到框外", () => {
    const html = renderToString(<>{waveform([150, -5, "x", 42.6], 0)}</>);

    expect(html).toContain('data-bars="3"');
    expect(html).toContain("height:100%");
    expect(html).toContain("height:0%");
    expect(html).toContain("height:43%");
    expect(html).toContain("0:00");
  });

  it("没有峰值就一根柱子都不画，但时长照样标出来", () => {
    const html = renderToString(<>{waveform([], 3)}</>);

    expect(html).toContain('data-bars="0"');
    expect(html).not.toContain("omora-peak\"");
    expect(html).toContain("0:03");
  });

  it("缺 seconds 时按 0:00 标，而不是空白", () => {
    const html = renderToString(<>{waveform([30], undefined)}</>);

    expect(html).toContain('data-bars="1"');
    expect(html).toContain("0:00");
  });
});

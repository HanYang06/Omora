import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { renderTree } from "./renderer";

/** 一条静态波形节点。 */
function waveform(src: unknown): ReturnType<typeof renderTree> {
  return renderTree([{ type: "waveform", props: { src }, children: [] }]);
}

describe("静态波形", () => {
  it("画的是媒体地址那条音频，节点只交出 src", () => {
    const html = renderToString(<>{waveform("http://127.0.0.1:1/media/abc")}</>);

    expect(html).toContain('data-type="waveform"');
    expect(html).toContain('data-src="http://127.0.0.1:1/media/abc"');
  });

  it("没有地址就画个空盒子，不报错", () => {
    const html = renderToString(<>{waveform(undefined)}</>);

    expect(html).toContain('data-type="waveform"');
    expect(html).toContain('data-src=""');
  });
});

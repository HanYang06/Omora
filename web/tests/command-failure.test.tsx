import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Shell } from "../src/shell/shell";

describe("命令失败要让人看见", () => {
  it("有 notice 时把它渲染在状态栏上方", () => {
    const html = renderToStaticMarkup(
      <Shell contributions={{}} status="online" notice="命令失败:灵感不能没有标题" />,
    );

    expect(html).toContain("命令失败:灵感不能没有标题");
    expect(html).toContain('data-status-notice="true"');
  });

  it("没有失败时不留空提示", () => {
    const html = renderToStaticMarkup(<Shell contributions={{}} status="online" />);

    expect(html).not.toContain("data-status-notice");
  });
});

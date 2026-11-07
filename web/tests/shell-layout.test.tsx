import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Shell } from "../src/shell/shell";
import type { SlotContribution } from "../src/shell/types";

const SIDEBAR: readonly SlotContribution[] = [
  { nodes: [{ type: "Text", props: { text: "SIDE-ONLY" } }] },
];

const MAIN: readonly SlotContribution[] = [
  { nodes: [{ type: "Text", props: { text: "MAIN-ONLY" } }] },
];

describe("shell layout", () => {
  it("places each slot contribution inside its own region", () => {
    const html = renderToStaticMarkup(<Shell contributions={{ sidebar: SIDEBAR, main: MAIN }} />);
    const mainStart = html.indexOf('data-slot="main"');
    const sidebarHtml = html.slice(0, mainStart);
    const mainHtml = html.slice(mainStart);

    expect(mainStart).toBeGreaterThan(html.indexOf('data-slot="sidebar"'));
    expect(sidebarHtml).toContain("SIDE-ONLY");
    expect(sidebarHtml).not.toContain("MAIN-ONLY");
    expect(mainHtml).toContain("MAIN-ONLY");
    expect(mainHtml).not.toContain("SIDE-ONLY");
  });

  it("shows an empty state when a slot has no contributions", () => {
    const html = renderToStaticMarkup(<Shell contributions={{}} status="online" />);

    expect(html).toContain("侧边栏还没有内容");
    expect(html).toContain("主区还没有内容");
  });

  it("says the kernel is not connected instead of pretending to have data", () => {
    const html = renderToStaticMarkup(<Shell contributions={{}} />);

    expect(html).toContain("未连接内核");
    expect(html).not.toContain("主区还没有内容");
  });

  it("shows the live revision and connection state in the status bar", () => {
    const html = renderToStaticMarkup(<Shell contributions={{}} revision={42} status="online" />);

    expect(html).toContain('data-revision="42"');
    expect(html).toContain("rev 42");
    expect(html).toContain("已连接");
  });
});

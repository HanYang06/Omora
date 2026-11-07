import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Shell } from "../src/shell/shell";

describe("shell slots", () => {
  it("keeps the fixed sidebar and main layout while rendering contributions", () => {
    const html = renderToStaticMarkup(
      <Shell
        contributions={{
          sidebar: [{ nodes: [{ type: "Text", props: { text: "SIDE-CONTENT" } }] }],
          main: [{ nodes: [{ type: "Text", props: { text: "MAIN-CONTENT" } }] }],
        }}
      />,
    );

    const sidebarSlot = html.indexOf('data-slot="sidebar"');
    const sidebarContent = html.indexOf("SIDE-CONTENT");
    const mainSlot = html.indexOf('data-slot="main"');
    const mainContent = html.indexOf("MAIN-CONTENT");

    expect(sidebarSlot).toBeGreaterThanOrEqual(0);
    expect(sidebarContent).toBeGreaterThan(sidebarSlot);
    expect(mainSlot).toBeGreaterThan(sidebarContent);
    expect(mainContent).toBeGreaterThan(mainSlot);
  });

  it("passes the slot scope to bound nodes", () => {
    const html = renderToStaticMarkup(
      <Shell
        contributions={{
          main: [
            {
              nodes: [{ type: "Text", props: { text: "$label" } }],
              scope: { label: "SCOPED" },
            },
          ],
        }}
      />,
    );

    expect(html).toContain("SCOPED");
  });
});

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { UiSnapshot } from "../src/contract";
import { contributionsFromUi } from "../src/shell/contributions";
import { Shell } from "../src/shell/shell";

describe("slot contributions", () => {
  it("resolves each contribution binding in its owner's state slice", () => {
    const ui: UiSnapshot = {
      slots: {
        main: [
          { owner: "plugin.a", nodes: [{ type: "Text", props: { text: "$label" } }] },
          { owner: "plugin.b", nodes: [{ type: "Text", props: { text: "$label" } }] },
        ],
      },
    };

    const contributions = contributionsFromUi(ui, {
      "plugin.a": { label: "A" },
      "plugin.b": { label: "B" },
    });
    const html = renderToStaticMarkup(<Shell contributions={contributions} />);

    expect(html).toContain("A");
    expect(html).toContain("B");
  });

  it("ignores slots that are outside the P0 layout", () => {
    const ui: UiSnapshot = {
      slots: { panel: [{ owner: "plugin.a", nodes: [] }] },
    };

    expect(contributionsFromUi(ui, {})).toEqual({});
  });
});

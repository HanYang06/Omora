import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { C3Node, CmdInvokeParams } from "../src/contract";
import { NodeRenderer } from "../src/renderer";

function render(
  nodes: readonly C3Node[],
  scope: Record<string, unknown> = {},
  onCommand?: (command: CmdInvokeParams) => void,
): string {
  return renderToStaticMarkup(<NodeRenderer nodes={nodes} scope={scope} onCommand={onCommand} />);
}

describe("schema renderer", () => {
  it("renders unknown node types as a placeholder instead of throwing", () => {
    const unknown = { type: "Mystery", props: {} } as unknown as C3Node;

    const html = render([unknown]);

    expect(html).toContain('data-omora-placeholder="Mystery"');
  });

  it("maps each known node type to its primitive widget", () => {
    const html = render(
      [
        {
          type: "Stack",
          props: { direction: "vertical", gap: 4 },
          children: [
            { type: "Text", props: { text: "hello" } },
            { type: "Button", props: { label: "go" } },
            { type: "Input", props: { placeholder: "type" } },
            {
              type: "List",
              props: { items: "$items" },
              children: [{ type: "Text", props: { text: "$item" } }],
            },
            { type: "Card", props: { title: "box" }, children: [] },
          ],
        },
      ],
      { items: ["first"] },
    );

    for (const widget of ["Stack", "Text", "Button", "Input", "List", "Card"]) {
      expect(html).toContain(`data-widget="${widget}"`);
    }
    expect(html).toContain("hello");
    expect(html).toContain("first");
  });

  it("gives each list item its own binding scope", () => {
    const html = render(
      [
        {
          type: "List",
          props: { items: "$items" },
          children: [{ type: "Text", props: { text: "$item.label" } }],
        },
      ],
      { items: [{ label: "first" }, { label: "second" }] },
    );

    expect(html).toContain("first");
    expect(html).toContain("second");
  });
});

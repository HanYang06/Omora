import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DocumentError, parseDocument } from "./document";

const FIXTURE_URL = new URL("../../../sdk/tests/fixtures/document.json", import.meta.url);
const fixture: unknown = JSON.parse(readFileSync(fileURLToPath(FIXTURE_URL), "utf8"));

function slot(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: "root", kind: "dendro:slot", owner: "test", props: {}, children: [], ...over };
}

function documentOf(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: "dendro.ui/1",
    document: slot(),
    pages: [],
    active: "",
    data: {},
    version: 1,
    ...over,
  };
}

const invalid: Array<[string, Record<string, unknown>, string]> = [
  ["schema", documentOf({ schema: "omora.ui/2" }), "bad_schema"],
  ["duplicate id", documentOf({ document: slot({ children: [slot()] }) }), "duplicate_id"],
  ["kind", documentOf({ document: slot({ kind: "column" }) }), "bad_kind"],
  [
    "layout",
    documentOf({ document: slot({ layout: { flow: "diagonal", capacity: "many" } }) }),
    "bad_layout",
  ],
  ["events", documentOf({ document: slot({ events: { click: 1 } }) }), "bad_events"],
  [
    "active",
    documentOf({
      pages: [{ id: "page.x", label: "X", route: "/x", owner: "x" }],
      active: "page.y",
    }),
    "bad_active",
  ],
  [
    "collection template",
    documentOf({
      document: slot({
        collection: {
          source: "s",
          key: "id",
          select: "template",
          templates: { item: slot({ id: "tpl", kind: "bad" }) },
        },
      }),
    }),
    "bad_kind",
  ],
];

describe("Slot 文档契约：与 Python 共用同一份 fixture", () => {
  it("解析共享 fixture", () => {
    const document = parseDocument(fixture);

    expect(document.schema).toBe("dendro.ui/1");
    expect(document.active).toBe("page.ideas");
    expect(document.pages).toHaveLength(1);

    const nav = document.document.children[0];
    expect(nav?.id).toBe("dendro.window.nav");
    const link = nav?.children[0];
    expect(link?.events?.click).toBe("h0");

    const feed = document.document.children[1]?.children[0]?.children[0];
    expect(feed?.collection?.source).toBe("ideas.feed");
    expect(feed?.collection?.templates.item?.bind).toEqual({
      title: "item.title",
      meta: "item.meta",
    });

    const data = document.data["ideas.feed"] as { items: unknown[] };
    expect(data.items).toHaveLength(1);
  });

  it.each(invalid)("拒绝非法文档: %s", (_name, value, code) => {
    try {
      parseDocument(value);
      throw new Error("expected DocumentError");
    } catch (error) {
      expect(error).toBeInstanceOf(DocumentError);
      expect((error as DocumentError).code).toBe(code);
    }
  });
});

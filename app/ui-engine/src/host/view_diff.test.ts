import { describe, expect, it } from "vitest";
import type { SlotNode } from "../contract/document";
import { viewOps } from "./view_diff";

function node(overrides: Partial<SlotNode>): SlotNode {
  return {
    id: "root",
    kind: "dendro:window",
    owner: "test",
    props: {},
    children: [],
    ...overrides,
  };
}

function collection(): NonNullable<SlotNode["collection"]> {
  return {
    source: "feed",
    key: "id",
    select: "item",
    templates: {
      item: node({ id: "tpl", kind: "dendro:text", props: { text: "tpl" } }),
    },
  };
}

describe("viewOps：collection", () => {
  it("collection 不变时递归 diff 子节点，不整节点 replace", () => {
    const oldRoot = node({
      children: [
        node({
          id: "feed",
          collection: collection(),
          children: [node({ id: "item1", props: { text: "a" } })],
        }),
      ],
    });
    const newRoot = node({
      children: [
        node({
          id: "feed",
          collection: collection(),
          children: [node({ id: "item1", props: { text: "b" } })],
        }),
      ],
    });

    expect(viewOps(oldRoot, newRoot)).toEqual([
      { op: "update", id: "item1", props: { text: "b" } },
    ]);
  });

  it("collection 模板变化时整节点 replace", () => {
    const oldRoot = node({
      children: [node({ id: "feed", collection: collection() })],
    });
    const changed = collection();
    changed.templates.item = node({ id: "tpl", kind: "dendro:text", props: { text: "新" } });
    const newRoot = node({
      children: [node({ id: "feed", collection: changed })],
    });

    const ops = viewOps(oldRoot, newRoot);
    expect(ops).toHaveLength(1);
    expect(ops?.[0]).toMatchObject({ op: "replace", id: "feed" });
  });
});

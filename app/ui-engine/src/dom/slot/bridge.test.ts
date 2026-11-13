import { describe, expect, it } from "vitest";
import type { SlotNode } from "../../contract/document";
import { slotToNode } from "./bridge";

function slot(over: Partial<SlotNode> & { id: string }): SlotNode {
  return { kind: "dendro:slot", owner: "test", props: {}, children: [], ...over };
}

describe("slotToNode", () => {
  it("type 用带命名空间的 kind，并带出 id / props / children / events / layout", () => {
    const input = slot({
      id: "page.ideas",
      kind: "dendro:page",
      props: { label: "灵感" },
      events: { click: "h0" },
      layout: {
        flow: "row",
        capacity: "many",
        size: { width: 56 },
        gap: "s3",
        align: "center",
        scroll: "y",
      },
      children: [slot({ id: "page.ideas.body", kind: "dendro:layer" })],
    });

    expect(slotToNode(input)).toEqual({
      type: "dendro:page",
      id: "page.ideas",
      props: { label: "灵感" },
      events: { click: "h0" },
      layout: {
        flow: "row",
        capacity: "many",
        size: { width: 56 },
        gap: "s3",
        align: "center",
        scroll: "y",
      },
      children: [{ type: "dendro:layer", id: "page.ideas.body", props: {}, children: [] }],
    });
  });

  it("不改写入参：props / children / events / layout 与入参各自独立", () => {
    const input = slot({
      id: "a",
      props: { title: "买牛奶" },
      events: { click: "h7" },
      layout: { flow: "row", capacity: "many", size: { width: 56 } },
      children: [slot({ id: "a.b" })],
    });
    const before = structuredClone(input);
    const node = slotToNode(input);

    node.props.title = "改标题";
    node.children.push({ type: "dendro:slot", id: "a.c", props: {}, children: [] });
    node.events!.click = "h9";
    node.layout!.size!.width = 99;
    node.layout!.flow = "column";

    expect(input).toEqual(before);
  });

  it("不展开 collection.templates：模板不变成 children，也不进 Node", () => {
    const input = slot({
      id: "ideas.feed",
      collection: {
        source: "ideas.feed",
        key: "id",
        select: "template",
        templates: {
          item: slot({
            id: "tpl.ideas.item",
            kind: "ideas:card",
            bind: { title: "item.title" },
          }),
        },
      },
    });

    const node = slotToNode(input);

    expect(node.children).toEqual([]);
    expect(node).not.toHaveProperty("collection");
    expect(JSON.stringify(node)).not.toContain("tpl.ideas.item");
  });
});

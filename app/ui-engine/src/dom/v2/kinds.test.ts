// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { Node } from "../../core/types";
import { mountNode } from "./test_fixtures";

function node(type: string, over: Partial<Node> = {}): Node {
  return { type, props: {}, children: [], ...over };
}

describe("v2 容器 kind：layout.flow → 现有布局 class", () => {
  it("window 按 flow=row 画 .omora-row，data-type 记完整 kind", () => {
    const mounted = mountNode(
      node("dendro:window", {
        id: "dendro.window",
        layout: { flow: "row", capacity: "many" },
      }),
    );

    const el = mounted.container.querySelector<HTMLElement>('[data-type="dendro:window"]');
    expect(el?.className).toBe("omora-row");
    expect(el?.dataset.flow).toBe("row");
    mounted.destroy();
  });

  it("slot / layer / page：column 用 .omora-column，stack 用 column + data-flow=stack", () => {
    const mounted = mountNode(
      node("dendro:window", {
        id: "dendro.window",
        layout: { flow: "row", capacity: "many" },
        children: [
          node("dendro:slot", {
            id: "dendro.window.nav",
            layout: { flow: "column", capacity: "many", size: { width: 56 } },
          }),
          node("dendro:layer", {
            id: "overlay",
            layout: { flow: "stack", capacity: "many" },
          }),
          node("dendro:page", { id: "page.ideas" }),
        ],
      }),
    );

    const slotEl = mounted.container.querySelector<HTMLElement>('[data-type="dendro:slot"]');
    expect(slotEl?.className).toBe("omora-column");
    expect(slotEl?.dataset.flow).toBe("column");

    const layerEl = mounted.container.querySelector<HTMLElement>('[data-type="dendro:layer"]');
    expect(layerEl?.className).toBe("omora-column");
    expect(layerEl?.dataset.flow).toBe("stack");

    const pageEl = mounted.container.querySelector<HTMLElement>('[data-type="dendro:page"]');
    expect(pageEl?.className).toBe("");
    expect(pageEl?.dataset.flow).toBeUndefined();
    mounted.destroy();
  });

  it("update 原地改 class / data-flow，不重建元素", () => {
    const mounted = mountNode(
      node("dendro:window", {
        id: "dendro.window",
        layout: { flow: "column", capacity: "many" },
      }),
    );
    const before = mounted.container.querySelector('[data-type="dendro:window"]');

    mounted.render(
      node("dendro:window", {
        id: "dendro.window",
        layout: { flow: "row", capacity: "many" },
      }),
    );

    const after = mounted.container.querySelector<HTMLElement>('[data-type="dendro:window"]');
    expect(after).toBe(before);
    expect(after?.className).toBe("omora-row");
    expect(after?.dataset.flow).toBe("row");
    mounted.destroy();
  });
});

describe("dendro:page-link", () => {
  function link(over: Partial<Node> = {}): Node {
    return node("dendro:page-link", {
      id: "nav.ideas",
      props: { label: "灵感", icon: "ideas" },
      events: { click: "h0" },
      ...over,
    });
  }

  it("label / icon 落到 aria-label / title / 图标，handler 落 data-handler", () => {
    const mounted = mountNode(link());

    const button = mounted.container.querySelector<HTMLButtonElement>(".omora-page-link");
    expect(button?.tagName).toBe("BUTTON");
    expect(button?.className).toContain("omora-shell-item");
    expect(button?.getAttribute("aria-label")).toBe("灵感");
    expect(button?.title).toBe("灵感");
    expect(button?.dataset.handler).toBe("h0");
    expect(button?.disabled).toBe(false);
    expect(button?.hasAttribute("aria-disabled")).toBe(false);
    expect(button?.querySelector("svg")?.getAttribute("data-icon")).toBe("ideas");
    mounted.destroy();
  });

  it("没有 click handler 时禁用并标 aria-disabled", () => {
    const mounted = mountNode(link({ events: {} }));

    const button = mounted.container.querySelector<HTMLButtonElement>(".omora-page-link");
    expect(button?.disabled).toBe(true);
    expect(button?.getAttribute("aria-disabled")).toBe("true");
    expect(button?.hasAttribute("data-handler")).toBe(false);
    mounted.destroy();
  });

  it("click 经 handlerOf + ctx.event 回传 handler id", () => {
    const mounted = mountNode(link());

    mounted.container.querySelector<HTMLButtonElement>(".omora-page-link")?.click();

    expect(mounted.events).toEqual([{ handler: "h0", payload: {} }]);
    mounted.destroy();
  });

  it("update 换 label / icon / handler 并切换禁用态，元素复用", () => {
    const mounted = mountNode(link());
    const before = mounted.container.querySelector(".omora-page-link");

    mounted.render(link({ props: { label: "项目", icon: "projects" }, events: { click: "h1" } }));

    const updated = mounted.container.querySelector<HTMLButtonElement>(".omora-page-link");
    expect(updated).toBe(before);
    expect(updated?.getAttribute("aria-label")).toBe("项目");
    expect(updated?.title).toBe("项目");
    expect(updated?.dataset.handler).toBe("h1");
    expect(updated?.querySelector("svg")?.getAttribute("data-icon")).toBe("projects");

    mounted.render(link({ events: {} }));
    const disabled = mounted.container.querySelector<HTMLButtonElement>(".omora-page-link");
    expect(disabled).toBe(before);
    expect(disabled?.disabled).toBe(true);
    expect(disabled?.hasAttribute("data-handler")).toBe(false);
    mounted.destroy();
  });
});

// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { Layout } from "../../core/document";
import type { Node } from "../../core/types";
import { mountNode, type MountedV2 } from "./test_fixtures";

function node(type: string, over: Partial<Node> = {}): Node {
  return { type, props: {}, children: [], ...over };
}

function layoutNode(layout: Layout, over: Partial<Node> = {}): Node {
  return node("dendro:slot", { id: "layout-node", layout, ...over });
}

function byType(mounted: MountedV2, type: string): HTMLElement {
  const el = mounted.container.querySelector<HTMLElement>(`[data-type="${type}"]`);
  if (el === null) {
    throw new Error("没有渲染出 " + type);
  }
  return el;
}

function cssVar(el: HTMLElement, name: string): string {
  return el.style.getPropertyValue(name).trim();
}

const LAYOUT_VARS = [
  "--dendro-gap",
  "--dendro-align",
  "--dendro-overflow",
  "--dendro-width",
  "--dendro-height",
] as const;

const LAYOUT_ATTRS = [
  "data-gap",
  "data-align",
  "data-scroll",
  "data-size-width",
  "data-size-height",
] as const;

/** 没有 layout 字段（或字段缺省）时，容器不该多出任何布局变量 / data 属性。 */
function expectNoLayoutStyles(el: HTMLElement): void {
  for (const name of LAYOUT_VARS) {
    expect(cssVar(el, name), name).toBe("");
  }
  for (const attr of LAYOUT_ATTRS) {
    expect(el.hasAttribute(attr), attr).toBe(false);
  }
}

describe("v2 容器 kind：layout.flow → 现有布局 class", () => {
  it("window 按 flow=row 画 .omora-row，data-type / marker 记完整身份", () => {
    const mounted = mountNode(
      node("dendro:window", {
        id: "dendro.window",
        layout: { flow: "row", capacity: "many" },
      }),
    );

    const el = byType(mounted, "dendro:window");
    expect(el.className).toBe("omora-row");
    expect(el.dataset.flow).toBe("row");
    expect(el.dataset.dendroLayout).toBe("v2");
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

    const slotEl = byType(mounted, "dendro:slot");
    expect(slotEl.className).toBe("omora-column");
    expect(slotEl.dataset.flow).toBe("column");
    expect(slotEl.dataset.dendroLayout).toBe("v2");

    const layerEl = byType(mounted, "dendro:layer");
    expect(layerEl.className).toBe("omora-column");
    expect(layerEl.dataset.flow).toBe("stack");

    const pageEl = byType(mounted, "dendro:page");
    expect(pageEl.className).toBe("");
    expect(pageEl.hasAttribute("data-flow")).toBe(false);
    // marker 不依赖 layout：没有 layout 的 v2 容器也标出来，样式段才有统一钩子。
    expect(pageEl.dataset.dendroLayout).toBe("v2");
    mounted.destroy();
  });
});

describe("v2 容器 kind：layout → data 属性 / CSS 变量", () => {
  it("没有 layout 的容器不写布局变量与扩展属性，capacity 不进样式", () => {
    const page = mountNode(node("dendro:page", { id: "page.bare" }));
    expectNoLayoutStyles(byType(page, "dendro:page"));
    page.destroy();

    const window = mountNode(
      node("dendro:window", { id: "dendro.window", layout: { flow: "row", capacity: "many" } }),
    );
    const windowEl = byType(window, "dendro:window");
    expectNoLayoutStyles(windowEl);
    expect(windowEl.hasAttribute("data-capacity")).toBe(false);
    window.destroy();
  });

  it("gap / align / scroll / size 全字段一次渲染：data 属性与 --dendro-* 都落上", () => {
    const mounted = mountNode(
      layoutNode({
        flow: "column",
        capacity: "many",
        gap: "md",
        align: "center",
        scroll: "x",
        size: { width: 56, height: "fill" },
      }),
    );

    const el = byType(mounted, "dendro:slot");
    expect(el.className).toBe("omora-column");
    expect(el.dataset.flow).toBe("column");
    expect(el.dataset.gap).toBe("md");
    expect(el.dataset.align).toBe("center");
    expect(el.dataset.scroll).toBe("x");
    expect(el.dataset.sizeWidth).toBe("56");
    expect(el.dataset.sizeHeight).toBe("fill");
    expect(cssVar(el, "--dendro-gap")).toBe("var(--s3)");
    expect(cssVar(el, "--dendro-align")).toBe("center");
    expect(cssVar(el, "--dendro-overflow")).toBe("auto hidden");
    expect(cssVar(el, "--dendro-width")).toBe("56px");
    expect(cssVar(el, "--dendro-height")).toBe("100%");
    mounted.destroy();
  });

  it("gap token：语义档映射到间距刻度，sN 映射同名变量，表外 token 原样", () => {
    const cases = [
      { gap: "none", css: "0" },
      { gap: "sm", css: "var(--s2)" },
      { gap: "lg", css: "var(--s4)" },
      { gap: "s5", css: "var(--s5)" },
      { gap: "1.5rem", css: "1.5rem" },
    ];
    for (const { gap, css } of cases) {
      const mounted = mountNode(
        layoutNode({ flow: "column", capacity: "many", gap }, { id: "gap-" + gap }),
      );
      const el = byType(mounted, "dendro:slot");
      expect(el.dataset.gap, gap).toBe(gap);
      expect(cssVar(el, "--dendro-gap"), gap).toBe(css);
      mounted.destroy();
    }
  });

  it("align 原样透传，scroll 三态映射成 overflow 简写", () => {
    const scrolls = [
      { scroll: "none" as const, css: "visible" },
      { scroll: "x" as const, css: "auto hidden" },
      { scroll: "y" as const, css: "hidden auto" },
    ];
    for (const { scroll, css } of scrolls) {
      const mounted = mountNode(
        layoutNode(
          { flow: "column", capacity: "many", align: "start", scroll },
          { id: "scroll-" + scroll },
        ),
      );
      const el = byType(mounted, "dendro:slot");
      expect(el.dataset.align).toBe("start");
      expect(cssVar(el, "--dendro-align")).toBe("start");
      expect(el.dataset.scroll, scroll).toBe(scroll);
      expect(cssVar(el, "--dendro-overflow"), scroll).toBe(css);
      mounted.destroy();
    }
  });

  it("size：数字→px、fill→100%、其余字符串原样", () => {
    const cases = [
      { width: 0 as string | number, css: "0px" },
      { width: "fill", css: "100%" },
      { width: "12rem", css: "12rem" },
      { width: "auto", css: "auto" },
    ];
    for (const { width, css } of cases) {
      const mounted = mountNode(
        layoutNode(
          { flow: "row", capacity: "many", size: { width } },
          { id: "width-" + String(width) },
        ),
      );
      const el = byType(mounted, "dendro:slot");
      expect(el.dataset.sizeWidth, String(width)).toBe(String(width));
      expect(cssVar(el, "--dendro-width"), String(width)).toBe(css);
      mounted.destroy();
    }
  });
});

describe("v2 容器 kind：update 清理与原地更新", () => {
  it("update 换 flow 时 class / data-flow 跟着变，删掉的字段清掉变量与 data 属性", () => {
    const mounted = mountNode(
      layoutNode({
        flow: "column",
        capacity: "many",
        gap: "md",
        align: "center",
        scroll: "y",
        size: { width: 56, height: "fill" },
      }),
    );
    const before = byType(mounted, "dendro:slot");

    mounted.render(layoutNode({ flow: "row", capacity: "many" }));

    const after = byType(mounted, "dendro:slot");
    expect(after).toBe(before);
    expect(after.className).toBe("omora-row");
    expect(after.dataset.flow).toBe("row");
    expect(after.dataset.type).toBe("dendro:slot");
    expect(after.dataset.dendroLayout).toBe("v2");
    expectNoLayoutStyles(after);
    mounted.destroy();
  });

  it("update 只清删掉的字段：仍在的 gap / size 跟着改，align / scroll 清空", () => {
    const mounted = mountNode(
      layoutNode({
        flow: "column",
        capacity: "many",
        gap: "md",
        align: "center",
        scroll: "x",
        size: { width: 56 },
      }),
    );
    const before = byType(mounted, "dendro:slot");

    mounted.render(
      layoutNode({ flow: "column", capacity: "many", gap: "lg", size: { width: "fill" } }),
    );

    const after = byType(mounted, "dendro:slot");
    expect(after).toBe(before);
    expect(after.dataset.gap).toBe("lg");
    expect(cssVar(after, "--dendro-gap")).toBe("var(--s4)");
    expect(after.dataset.sizeWidth).toBe("fill");
    expect(cssVar(after, "--dendro-width")).toBe("100%");
    expect(after.hasAttribute("data-align")).toBe(false);
    expect(cssVar(after, "--dendro-align")).toBe("");
    expect(after.hasAttribute("data-scroll")).toBe(false);
    expect(cssVar(after, "--dendro-overflow")).toBe("");
    mounted.destroy();
  });
});

describe("v1 kind 不受影响", () => {
  it("dendro:column 仍走 v1 实现：只有 v1 class，没有 v2 marker 与布局变量", () => {
    const mounted = mountNode(node("dendro:column", { id: "v1.column" }));

    const el = mounted.container.querySelector<HTMLElement>(".omora-column");
    if (el === null) {
      throw new Error("v1 column 应该渲染出 .omora-column");
    }
    expect(el.dataset.type).toBe("column");
    expect(el.hasAttribute("data-dendro-layout")).toBe(false);
    expectNoLayoutStyles(el);
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

// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { Node } from "../renderer/types";
import { mount } from "./testing";

function node(type: string, props: Record<string, unknown> = {}, children: Node[] = []): Node {
  return { type, props, children };
}

function text(value: string): Node {
  return node("text", { text: value });
}

function column(children: Node[], props: Record<string, unknown> = {}): Node {
  return node("column", props, children);
}

function tabsNode(children: Node[]): Node {
  return node("tabs", {}, children);
}

function accordionNode(children: Node[], open?: number): Node {
  return node("accordion", open === undefined ? {} : { open }, children);
}

function find<T extends Element>(root: ParentNode, selector: string): T {
  const el = root.querySelector<T>(selector);
  if (el === null) {
    throw new Error("没有找到 " + selector);
  }
  return el;
}

function findAll<T extends Element>(root: ParentNode, selector: string): T[] {
  return Array.from(root.querySelectorAll<T>(selector));
}

function press(el: Element, key: string): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  el.dispatchEvent(event);
  return event;
}

describe("tabs", () => {
  it("画标签栏与每页一个面板，默认第一页", () => {
    const mounted = mount(
      tabsNode([
        column([text("甲")], { label: "第一页" }),
        column([text("乙")], { label: "第二页" }),
      ]),
    );
    const buttons = findAll<HTMLButtonElement>(mounted.root, ".omora-tabs-bar .omora-tab");
    expect(buttons.map((b) => b.textContent)).toEqual(["第一页", "第二页"]);
    expect(buttons[0]?.getAttribute("role")).toBe("tab");
    expect(buttons[0]?.getAttribute("aria-selected")).toBe("true");
    expect(buttons[0]?.className).toBe("omora-tab is-active");
    expect(buttons[1]?.getAttribute("aria-selected")).toBe("false");

    const panels = findAll<HTMLElement>(mounted.root, ".omora-tabs-panel");
    expect(panels).toHaveLength(2);
    expect(panels[0]?.getAttribute("role")).toBe("tabpanel");
    expect(panels[0]?.getAttribute("aria-labelledby")).toBe(buttons[0]?.id);
    expect(panels[0]?.hidden).toBe(false);
    expect(panels[1]?.hidden).toBe(true);
    expect(find(panels[0] as HTMLElement, ".omora-column").textContent).toBe("甲");

    mounted.destroy();
  });

  it("点标签切页", () => {
    const mounted = mount(
      tabsNode([
        column([text("甲")], { label: "第一页" }),
        column([text("乙")], { label: "第二页" }),
      ]),
    );
    const buttons = findAll<HTMLButtonElement>(mounted.root, ".omora-tab");
    const panels = findAll<HTMLElement>(mounted.root, ".omora-tabs-panel");

    buttons[1]?.click();

    expect(buttons[1]?.getAttribute("aria-selected")).toBe("true");
    expect(buttons[0]?.getAttribute("aria-selected")).toBe("false");
    expect(panels[0]?.hidden).toBe(true);
    expect(panels[1]?.hidden).toBe(false);

    mounted.destroy();
  });

  it("左右键在标签之间循环", () => {
    const mounted = mount(
      tabsNode([column([text("甲")], { label: "甲" }), column([text("乙")], { label: "乙" })]),
    );
    const bar = find<HTMLElement>(mounted.root, ".omora-tabs-bar");
    const panels = findAll<HTMLElement>(mounted.root, ".omora-tabs-panel");

    const right = press(bar, "ArrowRight");
    expect(right.defaultPrevented).toBe(true);
    expect(panels[1]?.hidden).toBe(false);

    press(bar, "ArrowRight");
    expect(panels[0]?.hidden).toBe(false);

    press(bar, "ArrowLeft");
    expect(panels[1]?.hidden).toBe(false);

    mounted.destroy();
  });

  it("更新原地改标签名与内容，增删页不重建已有按钮", () => {
    const mounted = mount(
      tabsNode([column([text("甲")], { label: "旧一" }), column([text("乙")], { label: "旧二" })]),
    );
    const button = find<HTMLButtonElement>(mounted.root, ".omora-tab");
    const panel = find<HTMLElement>(mounted.root, ".omora-tabs-panel");

    mounted.render(
      tabsNode([
        column([text("新甲")], { label: "新一" }),
        column([text("乙")], { label: "旧二" }),
      ]),
    );

    expect(find<HTMLButtonElement>(mounted.root, ".omora-tab")).toBe(button);
    expect(button.textContent).toBe("新一");
    expect(find<HTMLElement>(mounted.root, ".omora-tabs-panel")).toBe(panel);
    expect(panel.textContent).toBe("新甲");

    mounted.render(
      tabsNode([
        column([text("新甲")], { label: "新一" }),
        column([text("乙")], { label: "旧二" }),
        column([text("丙")], { label: "第三页" }),
      ]),
    );
    expect(findAll<HTMLElement>(mounted.root, ".omora-tab")).toHaveLength(3);
    expect(findAll<HTMLElement>(mounted.root, ".omora-tabs-panel")).toHaveLength(3);
    expect(findAll<HTMLElement>(mounted.root, ".omora-tabs-panel")[2]?.textContent).toBe("丙");

    mounted.render(tabsNode([column([text("独")], { label: "唯一" })]));
    expect(findAll<HTMLElement>(mounted.root, ".omora-tab")).toHaveLength(1);
    expect(findAll<HTMLElement>(mounted.root, ".omora-tabs-panel")).toHaveLength(1);
    expect(findAll<HTMLElement>(mounted.root, ".omora-tabs-panel")[0]?.textContent).toBe("独");

    mounted.destroy();
  });
});

describe("accordion", () => {
  it("默认全部收起：标题、加号、aria-expanded", () => {
    const mounted = mount(
      accordionNode([
        column([text("一的内容")], { label: "第一节" }),
        column([text("二的内容")], { label: "第二节" }),
      ]),
    );
    const items = findAll<HTMLElement>(mounted.root, ".omora-accordion-item");
    const heads = findAll<HTMLButtonElement>(mounted.root, ".omora-accordion-head");
    const bodies = findAll<HTMLElement>(mounted.root, ".omora-accordion-body");

    expect(items).toHaveLength(2);
    expect(find(items[0] as HTMLElement, ".omora-accordion-title").textContent).toBe("第一节");
    expect(find(items[0] as HTMLElement, ".omora-accordion-mark").textContent).toBe("+");
    expect(heads[0]?.getAttribute("aria-expanded")).toBe("false");
    expect(items[0]?.dataset.open).toBe("false");
    expect(bodies[0]?.hidden).toBe(true);
    expect(bodies[0]?.textContent).toBe("一的内容");

    mounted.destroy();
  });

  it("点标题展开一节，点另一节时只留一节", () => {
    const mounted = mount(
      accordionNode([
        column([text("一的内容")], { label: "第一节" }),
        column([text("二的内容")], { label: "第二节" }),
      ]),
    );
    const heads = findAll<HTMLButtonElement>(mounted.root, ".omora-accordion-head");
    const items = findAll<HTMLElement>(mounted.root, ".omora-accordion-item");
    const bodies = findAll<HTMLElement>(mounted.root, ".omora-accordion-body");

    heads[0]?.click();
    expect(items[0]?.dataset.open).toBe("true");
    expect(heads[0]?.getAttribute("aria-expanded")).toBe("true");
    expect(find(items[0] as HTMLElement, ".omora-accordion-mark").textContent).toBe("−");
    expect(bodies[0]?.hidden).toBe(false);

    heads[1]?.click();
    expect(bodies[0]?.hidden).toBe(true);
    expect(bodies[1]?.hidden).toBe(false);
    expect(items[0]?.dataset.open).toBe("false");
    expect(items[1]?.dataset.open).toBe("true");

    heads[1]?.click();
    expect(bodies[1]?.hidden).toBe(true);

    mounted.destroy();
  });

  it("props.open 决定初始展开那一节", () => {
    const mounted = mount(
      accordionNode(
        [column([text("一")], { label: "第一节" }), column([text("二")], { label: "第二节" })],
        1,
      ),
    );
    const items = findAll<HTMLElement>(mounted.root, ".omora-accordion-item");
    const bodies = findAll<HTMLElement>(mounted.root, ".omora-accordion-body");

    expect(items[1]?.dataset.open).toBe("true");
    expect(bodies[0]?.hidden).toBe(true);
    expect(bodies[1]?.hidden).toBe(false);
    expect(find(items[1] as HTMLElement, ".omora-accordion-mark").textContent).toBe("−");

    mounted.destroy();
  });

  it("更新原地改标题与内容，增删节不重建已有节", () => {
    const mounted = mount(
      accordionNode([
        column([text("一")], { label: "旧一" }),
        column([text("二")], { label: "旧二" }),
      ]),
    );
    const section = find<HTMLElement>(mounted.root, ".omora-accordion-item");
    const head = find<HTMLButtonElement>(mounted.root, ".omora-accordion-head");

    mounted.render(
      accordionNode([
        column([text("新一")], { label: "新一" }),
        column([text("二")], { label: "旧二" }),
      ]),
    );

    expect(find<HTMLElement>(mounted.root, ".omora-accordion-item")).toBe(section);
    expect(find<HTMLButtonElement>(mounted.root, ".omora-accordion-head")).toBe(head);
    expect(find(section, ".omora-accordion-title").textContent).toBe("新一");
    expect(find<HTMLElement>(mounted.root, ".omora-accordion-body").textContent).toBe("新一");

    mounted.render(
      accordionNode([
        column([text("一")], { label: "一" }),
        column([text("二")], { label: "二" }),
        column([text("三")], { label: "三" }),
      ]),
    );
    expect(findAll<HTMLElement>(mounted.root, ".omora-accordion-item")).toHaveLength(3);
    expect(findAll<HTMLElement>(mounted.root, ".omora-accordion-head")[2]?.textContent).toBe("三+");

    mounted.render(accordionNode([column([text("一")], { label: "一" })]));
    expect(findAll<HTMLElement>(mounted.root, ".omora-accordion-item")).toHaveLength(1);
    expect(findAll<HTMLElement>(mounted.root, ".omora-accordion-body")).toHaveLength(1);
    expect(find<HTMLElement>(mounted.root, ".omora-accordion-body").textContent).toBe("一");

    mounted.destroy();
  });
});

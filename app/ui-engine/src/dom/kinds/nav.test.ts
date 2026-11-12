// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Node } from "../../core/types";
import { mount } from "../testing";
import { SEARCH_DEBOUNCE_MS } from "./nav";

afterEach(() => {
  vi.useRealTimers();
});

function node(type: string, props: Record<string, unknown> = {}, children: Node[] = []): Node {
  return { type, props, children };
}

function text(value: string, props: Record<string, unknown> = {}): Node {
  return node("text", { text: value, ...props });
}

function column(children: Node[], props: Record<string, unknown> = {}): Node {
  return node("column", props, children);
}

function search(props: Record<string, unknown> = {}, children: Node[] = []): Node {
  return node("search", props, children);
}

function suggestionNode(props: Record<string, unknown> = {}): Node {
  return node("suggestion", props);
}

function resultNode(props: Record<string, unknown> = {}): Node {
  return node("result", props);
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

function typeInto(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function press(el: Element, key: string): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  el.dispatchEvent(event);
  return event;
}

describe("search", () => {
  it("画出搜索框：图标、输入、按钮、下拉", () => {
    const mounted = mount(search({ placeholder: "搜索灵感…", value: "旧", on_submit: "h-submit" }));
    const root = find<HTMLElement>(mounted.root, ".omora-search");

    expect(root.dataset.type).toBe("search");
    expect(root.dataset.open).toBe("false");
    expect(find(root, ".omora-search-icon svg").getAttribute("data-icon")).toBe("search");

    const input = find<HTMLInputElement>(root, ".omora-search-input");
    expect(input.dataset.type).toBe("search-input");
    expect(input.placeholder).toBe("搜索灵感…");
    expect(input.value).toBe("旧");
    expect(input.getAttribute("role")).toBe("combobox");
    expect(input.getAttribute("aria-autocomplete")).toBe("list");
    expect(input.getAttribute("aria-expanded")).toBe("false");

    const submit = find<HTMLButtonElement>(root, ".omora-search-submit");
    expect(submit.dataset.type).toBe("search-submit");
    expect(submit.textContent).toBe("搜索");
    expect(submit.disabled).toBe(false);

    const list = find<HTMLElement>(root, ".omora-search-list");
    expect(list.dataset.type).toBe("search-list");
    expect(list.getAttribute("role")).toBe("listbox");
    expect(list.hidden).toBe(true);

    mounted.destroy();
  });

  it("没有 on_submit 时提交按钮禁用", () => {
    const mounted = mount(search({ on_query: "h-query" }));
    const submit = find<HTMLButtonElement>(mounted.root, ".omora-search-submit");

    expect(submit.disabled).toBe(true);
    submit.click();
    expect(mounted.events).toHaveLength(0);

    mounted.destroy();
  });

  it("打字防抖后发 on_query，只发最后一次", () => {
    vi.useFakeTimers();
    const mounted = mount({
      type: "search",
      props: {},
      children: [],
      events: { query: "h-query" },
    });
    const input = find<HTMLInputElement>(mounted.root, ".omora-search-input");

    typeInto(input, "牛");
    expect(mounted.events).toHaveLength(0);
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1);
    expect(mounted.events).toHaveLength(0);

    typeInto(input, "牛奶");
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    expect(mounted.events).toEqual([{ handler: "h-query", payload: { value: "牛奶" } }]);

    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS * 3);
    expect(mounted.events).toHaveLength(1);

    mounted.destroy();
  });

  it("回车提交去空格、回填并收起下拉", () => {
    const mounted = mount(
      search({ on_submit: "h-submit" }, [
        suggestionNode({ value: "牛奶", title: "牛奶", on_pick: "h-pick" }),
      ]),
    );
    const input = find<HTMLInputElement>(mounted.root, ".omora-search-input");
    const list = find<HTMLElement>(mounted.root, ".omora-search-list");
    expect(list.hidden).toBe(false);

    typeInto(input, "  牛奶  ");
    press(input, "Enter");

    expect(mounted.events).toEqual([{ handler: "h-submit", payload: { value: "牛奶" } }]);
    expect(input.value).toBe("牛奶");
    expect(list.hidden).toBe(true);
    expect(find<HTMLElement>(mounted.root, ".omora-search").dataset.open).toBe("false");

    mounted.destroy();
  });

  it("空输入回车不发事件", () => {
    const mounted = mount(search({ on_submit: "h-submit" }));
    const input = find<HTMLInputElement>(mounted.root, ".omora-search-input");

    typeInto(input, "   ");
    press(input, "Enter");

    expect(mounted.events).toHaveLength(0);
    mounted.destroy();
  });

  it("上下键移动高亮，回车选中建议", () => {
    const mounted = mount(
      search({ on_query: "h-query" }, [
        suggestionNode({ value: "买牛奶", title: "买牛奶", on_pick: "h-pick-a" }),
        suggestionNode({ value: "牛奶要冷的", title: "牛奶要冷的", on_pick: "h-pick-b" }),
      ]),
    );
    const input = find<HTMLInputElement>(mounted.root, ".omora-search-input");
    const options = findAll<HTMLElement>(mounted.root, ".omora-search-option");
    expect(options).toHaveLength(2);

    const down = press(input, "ArrowDown");
    expect(down.defaultPrevented).toBe(true);
    expect(options[0]?.classList.contains("omora-search-option--active")).toBe(true);
    press(input, "ArrowDown");
    expect(options[1]?.classList.contains("omora-search-option--active")).toBe(true);
    press(input, "ArrowUp");
    expect(options[0]?.classList.contains("omora-search-option--active")).toBe(true);
    expect(options[1]?.classList.contains("omora-search-option--active")).toBe(false);

    press(input, "Enter");
    expect(mounted.events).toEqual([{ handler: "h-pick-a", payload: { value: "买牛奶" } }]);
    expect(input.value).toBe("买牛奶");
    expect(find<HTMLElement>(mounted.root, ".omora-search-list").hidden).toBe(true);

    mounted.destroy();
  });

  it("Escape 收起下拉，再打字重新打开", () => {
    const mounted = mount(
      search({}, [suggestionNode({ value: "牛奶", title: "牛奶", on_pick: "h-pick" })]),
    );
    const input = find<HTMLInputElement>(mounted.root, ".omora-search-input");
    const list = find<HTMLElement>(mounted.root, ".omora-search-list");

    press(input, "ArrowDown");
    press(input, "Escape");
    expect(list.hidden).toBe(true);

    typeInto(input, "牛");
    expect(list.hidden).toBe(false);

    mounted.destroy();
  });

  it("快照带新 suggestions 时打开下拉并按子节点建选项", () => {
    const mounted = mount(search({ on_query: "h-query" }));

    mounted.render(
      search({ value: "牛奶" }, [
        suggestionNode({ value: "买牛奶", title: "买牛奶", highlight: "牛奶" }),
        suggestionNode({ value: "牛奶要冷的", title: "牛奶要冷的" }),
      ]),
    );

    const root = find<HTMLElement>(mounted.root, ".omora-search");
    const list = find<HTMLElement>(root, ".omora-search-list");
    expect(root.dataset.open).toBe("true");
    expect(list.hidden).toBe(false);
    expect(findAll<HTMLElement>(root, ".omora-search-option")).toHaveLength(2);
    expect(findAll<HTMLElement>(root, ".omora-search-option")[0]?.getAttribute("role")).toBe(
      "presentation",
    );
    expect(find<HTMLInputElement>(root, ".omora-search-input").value).toBe("牛奶");

    mounted.render(search({ value: "牛奶" }));
    expect(findAll<HTMLElement>(root, ".omora-search-option")).toHaveLength(0);
    expect(list.hidden).toBe(true);

    mounted.destroy();
  });

  it("快照带回同值不覆盖用户输入，换了值就回填", () => {
    const mounted = mount(search({ value: "旧" }));
    const input = find<HTMLInputElement>(mounted.root, ".omora-search-input");

    typeInto(input, "新");
    mounted.render(search({ value: "旧" }));
    expect(input.value).toBe("新");

    mounted.render(search({ value: "甲" }));
    expect(input.value).toBe("甲");

    mounted.destroy();
  });

  it("销毁会取消还没到点的防抖", () => {
    vi.useFakeTimers();
    const mounted = mount(search({ on_query: "h-query" }));
    const input = find<HTMLInputElement>(mounted.root, ".omora-search-input");

    typeInto(input, "牛");
    mounted.destroy();
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS * 3);

    expect(mounted.events).toHaveLength(0);
  });
});

describe("suggestion", () => {
  it("画出建议：命中词 <mark>、meta、data-handler", () => {
    const mounted = mount(
      suggestionNode({
        value: "买牛奶",
        title: "买牛奶",
        highlight: "牛奶",
        meta: "3 天前",
        on_pick: "h-props",
      }),
    );
    const button = find<HTMLButtonElement>(mounted.root, ".omora-suggestion");

    expect(button.dataset.type).toBe("suggestion");
    expect(button.getAttribute("role")).toBe("option");
    expect(button.dataset.handler).toBe("h-props");
    expect(findAll<HTMLElement>(button, "mark").map((el) => el.textContent)).toEqual(["牛奶"]);
    expect(find(button, ".omora-suggestion-title").textContent).toBe("买牛奶");
    expect(find(button, ".omora-suggestion-meta").textContent).toBe("3 天前");

    button.click();
    expect(mounted.events).toEqual([{ handler: "h-props", payload: { value: "买牛奶" } }]);
    mounted.destroy();
  });

  it("v1.5 events.pick 优先于 props.on_pick", () => {
    const mounted = mount({
      type: "suggestion",
      props: { value: "买牛奶", title: "买牛奶", on_pick: "h-props" },
      children: [],
      events: { pick: "h-event" },
    });
    const button = find<HTMLButtonElement>(mounted.root, ".omora-suggestion");

    expect(button.dataset.handler).toBe("h-event");
    button.click();
    expect(mounted.events).toEqual([{ handler: "h-event", payload: { value: "买牛奶" } }]);

    mounted.destroy();
  });

  it("更新原地改标题、去掉 meta、换 handler", () => {
    const mounted = mount(
      suggestionNode({
        value: "买牛奶",
        title: "买牛奶",
        highlight: "牛奶",
        meta: "3 天前",
        on_pick: "h-pick",
      }),
    );
    const button = find<HTMLButtonElement>(mounted.root, ".omora-suggestion");
    expect(findAll<HTMLElement>(button, "mark")).toHaveLength(1);

    mounted.render(suggestionNode({ value: "买牛奶", title: "买牛奶", on_pick: "h-pick-2" }));

    expect(find<HTMLButtonElement>(mounted.root, ".omora-suggestion")).toBe(button);
    expect(button.dataset.handler).toBe("h-pick-2");
    expect(findAll<HTMLElement>(button, "mark")).toHaveLength(0);
    expect(findAll<HTMLElement>(button, ".omora-suggestion-meta")).toHaveLength(0);

    button.click();
    expect(mounted.events).toEqual([{ handler: "h-pick-2", payload: { value: "买牛奶" } }]);
    mounted.destroy();
  });
});

describe("result", () => {
  it("画出结果：可点标题、命中词 snippet、meta", () => {
    const mounted = mount(
      resultNode({
        title: "买牛奶",
        snippet: "今晚买牛奶",
        highlight: "牛奶",
        meta: "3 天前",
        on_click: "h-open",
      }),
    );
    const el = find<HTMLElement>(mounted.root, ".omora-result");
    expect(el.tagName).toBe("LI");
    expect(el.dataset.type).toBe("result");

    const title = find<HTMLButtonElement>(el, ".omora-result-title");
    expect(title.dataset.handler).toBe("h-open");
    expect(title.textContent).toBe("买牛奶");
    expect(
      findAll<HTMLElement>(el, ".omora-result-snippet mark").map((m) => m.textContent),
    ).toEqual(["牛奶"]);

    title.click();
    expect(mounted.events).toEqual([{ handler: "h-open", payload: {} }]);
    mounted.destroy();
  });

  it("更新原地改标题、snippet 与 handler", () => {
    const mounted = mount(resultNode({ title: "买牛奶", on_click: "h-open" }));
    const title = find<HTMLButtonElement>(mounted.root, ".omora-result-title");
    const el = find<HTMLElement>(mounted.root, ".omora-result");

    mounted.render(
      resultNode({ title: "牛奶要冷的", snippet: "冷的才买", meta: "刚刚", on_click: "h-open-2" }),
    );

    expect(find<HTMLElement>(mounted.root, ".omora-result")).toBe(el);
    expect(title.textContent).toBe("牛奶要冷的");
    expect(title.dataset.handler).toBe("h-open-2");
    expect(find(el, ".omora-result-snippet").textContent).toBe("冷的才买");
    expect(find(el, ".omora-result-meta").textContent).toBe("刚刚");

    title.click();
    expect(mounted.events).toEqual([{ handler: "h-open-2", payload: {} }]);
    mounted.destroy();
  });
});

function tabsNode(children: Node[]): Node {
  return node("tabs", {}, children);
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

function accordionNode(children: Node[], open?: number): Node {
  return node("accordion", open === undefined ? {} : { open }, children);
}

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

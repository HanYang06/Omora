// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { Node } from "../renderer/types";
import { mount } from "./testing";

function make(
  type: string,
  props: Record<string, unknown> = {},
  children: Node[] = [],
  extra: Partial<Node> = {},
): Node {
  return { type, props, children, ...extra };
}

/** 未被本组实现覆盖的节点会画成占位框，用它当“任意子节点”的标记，避免跨组耦合。 */
function marker(name: string): Node {
  return make(name);
}

function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) {
    throw new Error("期望的元素不存在");
  }
  return value;
}

function markerIn(scope: ParentNode, name: string): HTMLElement {
  return must(scope.querySelector<HTMLElement>('[data-unknown-type="' + name + '"]'));
}

describe("容器类 kind", () => {
  it("column 保留 class / data-type，子节点按顺序挂进去", () => {
    const mounted = mount(make("column", {}, [marker("甲"), marker("乙")]));
    const el = must(mounted.root.querySelector<HTMLElement>(".omora-column"));

    expect(el.getAttribute("data-type")).toBe("column");
    expect(el.children).toHaveLength(2);
    expect(el.children[0]?.getAttribute("data-unknown-type")).toBe("甲");
    expect(el.children[1]?.getAttribute("data-unknown-type")).toBe("乙");
    mounted.destroy();
  });

  it("list / panel / slot 各自的标签、class、data-type 不变", () => {
    const cases = [
      { type: "list", tag: "UL", className: "omora-list" },
      { type: "panel", tag: "DIV", className: "omora-panel" },
      { type: "slot", tag: "DIV", className: "omora-slot" },
    ];
    for (const item of cases) {
      const mounted = mount(make(item.type, {}, [marker("child")]));
      const el = must(mounted.root.querySelector<HTMLElement>("." + item.className));

      expect(el.tagName).toBe(item.tag);
      expect(el.getAttribute("data-type")).toBe(item.type);
      expect(el.contains(markerIn(el, "child"))).toBe(true);
      mounted.destroy();
    }
  });

  it("column 更新复用同一元素，只重挂 children", () => {
    const mounted = mount(make("column", {}, [marker("甲")]));
    const before = must(mounted.root.querySelector<HTMLElement>(".omora-column"));

    mounted.render(make("column", {}, [marker("乙")]));

    const after = must(mounted.root.querySelector<HTMLElement>(".omora-column"));
    expect(after).toBe(before);
    expect(after.querySelector('[data-unknown-type="甲"]')).toBeNull();
    expect(markerIn(after, "乙")).not.toBeNull();
    mounted.destroy();
  });
});

describe("row", () => {
  it("spread 只切样式类，元素原地更新", () => {
    const mounted = mount(make("row"));
    const el = must(mounted.root.querySelector<HTMLElement>(".omora-row"));
    expect(el.className).toBe("omora-row");
    expect(el.getAttribute("data-type")).toBe("row");

    mounted.render(make("row", { spread: true }));

    expect(must(mounted.root.querySelector<HTMLElement>(".omora-row"))).toBe(el);
    expect(el.className).toBe("omora-row omora-row--spread");

    mounted.render(make("row", { spread: false }));

    expect(el.className).toBe("omora-row");
    mounted.destroy();
  });

  it("spread 只有 true 才算数", () => {
    const mounted = mount(make("row", { spread: "yes" }));

    expect(must(mounted.root.querySelector<HTMLElement>(".omora-row")).className).toBe("omora-row");
    mounted.destroy();
  });
});

describe("item", () => {
  const staticItem = (): Node => make("item", { meta: "刚刚", title: "买牛奶" }, [marker("act")]);

  it("静态行：meta + 标题 span，动作挂在动作容器里", () => {
    const mounted = mount(staticItem());
    const li = must(mounted.root.querySelector<HTMLElement>("li.omora-item"));

    expect(li.getAttribute("data-type")).toBe("item");
    expect(li.hasAttribute("data-handler")).toBe(false);
    expect(must(li.querySelector<HTMLElement>(".omora-item-meta")).textContent).toBe("刚刚");
    expect(must(li.querySelector<HTMLElement>(".omora-item-title")).tagName).toBe("SPAN");
    expect(li.querySelector(".omora-item-link")).toBeNull();

    const actions = must(li.querySelector<HTMLElement>(".omora-item-actions"));
    expect(markerIn(actions, "act")).toBeDefined();
    expect(actions.parentElement?.className).toBe("omora-item-main");
    mounted.destroy();
  });

  it("events.click 优先，props.on_click 兜底；点整行发 handler", () => {
    const fromEvents = make("item", { title: "甲", on_click: "fallback" }, [], {
      events: { click: "ideas:1:0" },
    });
    const mounted = mount(fromEvents);
    const li = must(mounted.root.querySelector<HTMLElement>("li.omora-item"));
    const link = must(li.querySelector<HTMLElement>(".omora-item-link"));

    expect(li.getAttribute("data-handler")).toBe("ideas:1:0");
    expect(link.getAttribute("data-handler")).toBe("ideas:1:0");
    expect(link.tagName).toBe("BUTTON");

    li.click();

    expect(mounted.events).toEqual([{ handler: "ideas:1:0", payload: {} }]);
    mounted.destroy();

    const fromProps = mount(make("item", { title: "乙", on_click: "ideas:2:0" }));
    const row = must(fromProps.root.querySelector<HTMLElement>("li.omora-item"));
    expect(row.getAttribute("data-handler")).toBe("ideas:2:0");
    row.click();
    expect(fromProps.events).toEqual([{ handler: "ideas:2:0", payload: {} }]);
    fromProps.destroy();
  });

  it("点标题按钮只发一次（不因整行监听重复触发）", () => {
    const mounted = mount(
      make("item", { title: "买牛奶" }, [], { events: { click: "ideas:3:0" } }),
    );
    const link = must(mounted.root.querySelector<HTMLElement>(".omora-item-link"));

    link.click();

    expect(mounted.events).toHaveLength(1);
    mounted.destroy();
  });

  it("点动作容器里的子节点不触发整行", () => {
    const mounted = mount(
      make("item", { title: "买牛奶" }, [marker("act")], { events: { click: "ideas:4:0" } }),
    );
    const action = markerIn(mounted.root, "act");

    action.click();

    expect(mounted.events).toEqual([]);
    mounted.destroy();
  });

  it("update 原地改 meta / 标题 / handler，动作容器始终存在", () => {
    const mounted = mount(make("item", { title: "旧标题", meta: "旧时间" }, [marker("act")]));
    const li = must(mounted.root.querySelector<HTMLElement>("li.omora-item"));
    const actions = must(li.querySelector<HTMLElement>(".omora-item-actions"));
    const main = must(li.querySelector<HTMLElement>(".omora-item-main"));

    mounted.render(make("item", { title: "新标题" }, [marker("act")]));

    expect(must(mounted.root.querySelector<HTMLElement>("li.omora-item"))).toBe(li);
    expect(must(li.querySelector<HTMLElement>(".omora-item-actions"))).toBe(actions);
    expect(must(li.querySelector<HTMLElement>(".omora-item-meta")).textContent).toBe("");
    expect(must(li.querySelector<HTMLElement>(".omora-item-title")).textContent).toBe("新标题");
    expect(li.hasAttribute("data-handler")).toBe(false);
    // 标题仍在动作容器前面。
    expect(main.children[0]?.className).toBe("omora-item-title");
    expect(main.children[1]).toBe(actions);
    expect(markerIn(actions, "act")).toBeDefined();

    // 加 handler：标题换成按钮，动作容器不动。
    mounted.render(
      make("item", { title: "新标题" }, [marker("act")], { events: { click: "ideas:5:0" } }),
    );

    expect(must(li.querySelector<HTMLElement>(".omora-item-actions"))).toBe(actions);
    expect(must(li.querySelector<HTMLElement>(".omora-item-link")).textContent).toBe("新标题");
    expect(main.children[0]?.className).toBe("omora-item-link");
    expect(main.children[1]).toBe(actions);
    li.click();
    expect(mounted.events).toEqual([{ handler: "ideas:5:0", payload: {} }]);

    // 去掉 handler：标题换回 span，动作容器还是同一个。
    mounted.render(make("item", { title: "新标题" }, [marker("act")]));
    expect(must(li.querySelector<HTMLElement>(".omora-item-actions"))).toBe(actions);
    expect(main.children[0]?.className).toBe("omora-item-title");
    mounted.destroy();
  });
});

describe("rail", () => {
  it("标题 + rail-list，子节点挂在 list 里", () => {
    const mounted = mount(make("rail", { title: "全部灵感" }, [marker("stub")]));
    const rail = must(mounted.root.querySelector<HTMLElement>("aside.omora-rail"));
    const heading = must(rail.querySelector<HTMLElement>(".omora-rail-title"));
    const list = must(rail.querySelector<HTMLElement>("ul.omora-rail-list"));

    expect(rail.getAttribute("data-type")).toBe("rail");
    expect(heading.tagName).toBe("H2");
    expect(heading.textContent).toBe("全部灵感");
    expect(rail.children[0]).toBe(heading);
    expect(rail.children[1]).toBe(list);
    expect(markerIn(list, "stub")).toBeDefined();
    mounted.destroy();
  });

  it("update 增删标题不换 rail-list，也不丢条目", () => {
    const mounted = mount(make("rail", { title: "全部灵感" }, [marker("stub")]));
    const rail = must(mounted.root.querySelector<HTMLElement>("aside.omora-rail"));
    const list = must(rail.querySelector<HTMLElement>("ul.omora-rail-list"));

    mounted.render(make("rail", {}, [marker("stub")]));

    expect(must(mounted.root.querySelector<HTMLElement>("aside.omora-rail"))).toBe(rail);
    expect(rail.querySelector(".omora-rail-title")).toBeNull();
    expect(must(rail.querySelector<HTMLElement>("ul.omora-rail-list"))).toBe(list);
    expect(markerIn(list, "stub")).toBeDefined();

    mounted.render(make("rail", { title: "改过的标题" }, [marker("stub")]));

    expect(rail.children[0]?.className).toBe("omora-rail-title");
    expect(must(rail.querySelector<HTMLElement>(".omora-rail-title")).textContent).toBe(
      "改过的标题",
    );
    expect(must(rail.querySelector<HTMLElement>("ul.omora-rail-list"))).toBe(list);
    mounted.destroy();
  });
});

describe("split", () => {
  it("先侧栏后主区：两个稳定 wrapper，子节点各进各的槽", () => {
    const mounted = mount(make("split", {}, [marker("side"), marker("main")]));
    const split = must(mounted.root.querySelector<HTMLElement>(".omora-split"));
    const side = must(split.querySelector<HTMLElement>(".omora-split-side"));
    const main = must(split.querySelector<HTMLElement>(".omora-split-main"));

    expect(split.getAttribute("data-type")).toBe("split");
    expect(side.getAttribute("data-slot")).toBe("side");
    expect(main.getAttribute("data-slot")).toBe("main");
    expect(split.children[0]).toBe(side);
    expect(split.children[1]).toBe(main);
    expect(side.children).toHaveLength(1);
    expect(main.children).toHaveLength(1);
    expect(markerIn(side, "side")).toBeDefined();
    expect(markerIn(main, "main")).toBeDefined();
    mounted.destroy();
  });

  it("update 按子节点下标重新分配两栏，wrapper 不换", () => {
    // 给两个子节点固定 id，update 时 renderer 按 id 复用元素。
    const first: Node = { type: "sideA", props: {}, children: [], id: "a" };
    const second: Node = { type: "mainB", props: {}, children: [], id: "b" };
    const mounted = mount(make("split", {}, [first, second]));
    const split = must(mounted.root.querySelector<HTMLElement>(".omora-split"));
    const side = must(split.querySelector<HTMLElement>(".omora-split-side"));
    const main = must(split.querySelector<HTMLElement>(".omora-split-main"));

    expect(markerIn(side, "sideA")).toBeDefined();
    expect(markerIn(main, "mainB")).toBeDefined();

    // 交换顺序：b 现在挂到 side，a 挂到 main。
    mounted.render(make("split", {}, [second, first]));

    expect(must(split.querySelector<HTMLElement>(".omora-split-side"))).toBe(side);
    expect(must(split.querySelector<HTMLElement>(".omora-split-main"))).toBe(main);
    expect(side.children).toHaveLength(1);
    expect(main.children).toHaveLength(1);
    expect(markerIn(side, "mainB")).toBeDefined();
    expect(markerIn(main, "sideA")).toBeDefined();
    mounted.destroy();
  });
});

describe("生命周期", () => {
  const factories: Record<string, () => Node> = {
    column: () => make("column"),
    row: () => make("row", { spread: true }),
    list: () => make("list"),
    item: () => make("item", { title: "买牛奶", meta: "刚刚" }, [marker("act")]),
    split: () => make("split", {}, [make("side"), make("main")]),
    rail: () => make("rail", { title: "全部" }, [marker("stub")]),
    panel: () => make("panel"),
    slot: () => make("slot"),
  };

  for (const [type, factory] of Object.entries(factories)) {
    it(type + " 卸载后从 DOM 移除", () => {
      const mounted = mount(factory());

      mounted.render(factory());
      mounted.destroy();

      expect(mounted.root.children).toHaveLength(0);
    });
  }
});

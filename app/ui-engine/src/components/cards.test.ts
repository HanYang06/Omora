// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { Node } from "../renderer/types";
import { registry } from "./registry";
import { DomRenderer } from "../renderer/renderer";
import type { Mounted, RecordedEvent } from "./testing";
import type { RenderContext } from "../renderer/types";
import { cardKinds } from "./cards";

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

/** cardKinds 还没汇入全局 registry（由 Lead 汇总），挂载时先把本组并进来。 */
function mountCards(node: Node): Mounted {
  const events: RecordedEvent[] = [];
  const context: RenderContext = {
    event: (handler, payload) => events.push({ handler, payload }),
    loadMedia: () => Promise.resolve({ mime: "", data: "" }),
    cleanup: () => undefined,
  };
  const container = document.createElement("div");
  document.body.appendChild(container);
  const renderer = new DomRenderer({ registry: { ...registry, ...cardKinds }, context });
  renderer.render(node, container);
  return {
    root: container,
    renderer,
    events,
    render: (next) => renderer.render(next, container),
    destroy: () => {
      renderer.dispose();
      container.remove();
    },
  };
}

describe("empty", () => {
  it("画标题和可选 hint，子节点不参与渲染", () => {
    // childrenHosts 返回 null 时 renderer 会 warn“不接受 children”，这是契约行为。
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const mounted = mountCards(
      make("empty", { title: "还没有灵感", hint: "先记一条" }, [marker("ignored")]),
    );
    warn.mockRestore();
    const empty = must(mounted.root.querySelector<HTMLElement>(".omora-empty"));

    expect(empty.getAttribute("data-type")).toBe("empty");
    expect(must(empty.querySelector<HTMLElement>(".omora-empty-title")).textContent).toBe(
      "还没有灵感",
    );
    expect(must(empty.querySelector<HTMLElement>(".omora-empty-hint")).textContent).toBe(
      "先记一条",
    );
    expect(mounted.root.querySelector("[data-unknown-type]")).toBeNull();
    mounted.destroy();
  });

  it("update 改标题、按需增删 hint", () => {
    const mounted = mountCards(make("empty", { title: "空", hint: "提示" }));
    const empty = must(mounted.root.querySelector<HTMLElement>(".omora-empty"));

    mounted.render(make("empty", { title: "还是空" }));

    expect(must(mounted.root.querySelector<HTMLElement>(".omora-empty"))).toBe(empty);
    expect(must(empty.querySelector<HTMLElement>(".omora-empty-title")).textContent).toBe("还是空");
    expect(empty.querySelector(".omora-empty-hint")).toBeNull();

    mounted.render(make("empty", { title: "还是空", hint: "再来一条" }));
    expect(empty.children).toHaveLength(2);
    expect(must(empty.querySelector<HTMLElement>(".omora-empty-hint")).textContent).toBe(
      "再来一条",
    );
    mounted.destroy();
  });
});

describe("card", () => {
  const clickableCard = (): Node =>
    make("card", { title: "买牛奶", text: "下班顺路", meta: "刚刚", on_click: "ideas:6:0" }, [
      marker("media"),
    ]);

  it("标题 / 正文 / 时间 / 媒体，可点属性齐全", () => {
    const mounted = mountCards(clickableCard());
    const card = must(mounted.root.querySelector<HTMLElement>("article.omora-card"));
    const media = must(card.querySelector<HTMLElement>(".omora-card-media"));

    expect(card.getAttribute("data-type")).toBe("card");
    expect(card.getAttribute("data-handler")).toBe("ideas:6:0");
    expect(card.getAttribute("role")).toBe("button");
    expect(card.getAttribute("tabindex")).toBe("0");
    expect(must(card.querySelector<HTMLElement>(".omora-card-title")).textContent).toBe("买牛奶");
    expect(must(card.querySelector<HTMLElement>(".omora-card-text")).textContent).toBe("下班顺路");
    expect(must(card.querySelector<HTMLElement>(".omora-card-meta")).textContent).toBe("刚刚");
    expect(markerIn(media, "media")).toBeDefined();
    mounted.destroy();
  });

  it("点整卡发事件；点媒体不发", () => {
    const mounted = mountCards(clickableCard());
    const card = must(mounted.root.querySelector<HTMLElement>("article.omora-card"));

    card.click();
    expect(mounted.events).toEqual([{ handler: "ideas:6:0", payload: {} }]);

    mounted.events.length = 0;
    markerIn(card, "media").click();
    expect(mounted.events).toEqual([]);
    mounted.destroy();
  });

  it("键盘 Enter / 空格触发并阻止默认滚动", () => {
    const mounted = mountCards(clickableCard());
    const card = must(mounted.root.querySelector<HTMLElement>("article.omora-card"));

    const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    card.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(true);
    expect(mounted.events).toEqual([{ handler: "ideas:6:0", payload: {} }]);

    mounted.events.length = 0;
    const space = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
    card.dispatchEvent(space);
    expect(space.defaultPrevented).toBe(true);
    expect(mounted.events).toHaveLength(1);

    mounted.events.length = 0;
    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true });
    card.dispatchEvent(escape);
    expect(mounted.events).toEqual([]);
    mounted.destroy();
  });

  it("没有 on_click 就是静态卡片：无 role / tabindex，键盘也不发事件", () => {
    const mounted = mountCards(make("card", { title: "静态" }));
    const card = must(mounted.root.querySelector<HTMLElement>("article.omora-card"));
    const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });

    expect(card.hasAttribute("data-handler")).toBe(false);
    expect(card.hasAttribute("role")).toBe(false);
    expect(card.hasAttribute("tabindex")).toBe(false);
    // 没有媒体子节点就不该出现空媒体容器（它会带 margin-top）。
    expect(card.querySelector(".omora-card-media")).toBeNull();

    card.dispatchEvent(enter);
    card.click();
    expect(enter.defaultPrevented).toBe(false);
    expect(mounted.events).toEqual([]);
    mounted.destroy();
  });

  it("媒体容器随子节点增删出现 / 消失，不泄漏空方块", () => {
    const mounted = mountCards(make("card", { title: "买牛奶" }));
    const card = must(mounted.root.querySelector<HTMLElement>("article.omora-card"));
    expect(card.querySelector(".omora-card-media")).toBeNull();

    mounted.render(make("card", { title: "买牛奶" }, [marker("media")]));

    const media = must(card.querySelector<HTMLElement>(".omora-card-media"));
    expect(markerIn(media, "media")).toBeDefined();

    mounted.render(make("card", { title: "买牛奶" }));

    expect(card.querySelector(".omora-card-media")).toBeNull();
    expect(card.children).toHaveLength(1);
    expect(card.children[0]?.className).toBe("omora-card-head");
    mounted.destroy();
  });

  it("update 原地改文案，按需增删 meta / 正文，媒体容器不换", () => {
    const mounted = mountCards(clickableCard());
    const card = must(mounted.root.querySelector<HTMLElement>("article.omora-card"));
    const media = must(card.querySelector<HTMLElement>(".omora-card-media"));

    mounted.render(make("card", { title: "新标题" }, [marker("media")]));

    expect(must(mounted.root.querySelector<HTMLElement>("article.omora-card"))).toBe(card);
    expect(must(card.querySelector<HTMLElement>(".omora-card-media"))).toBe(media);
    expect(must(card.querySelector<HTMLElement>(".omora-card-title")).textContent).toBe("新标题");
    expect(card.querySelector(".omora-card-text")).toBeNull();
    expect(card.querySelector(".omora-card-meta")).toBeNull();
    expect(card.hasAttribute("data-handler")).toBe(false);
    expect(card.hasAttribute("role")).toBe(false);
    expect(card.hasAttribute("tabindex")).toBe(false);
    expect(markerIn(media, "media")).toBeDefined();

    mounted.render(
      make("card", { title: "新标题", text: "新正文", meta: "现在" }, [marker("media")], {
        events: { click: "ideas:7:0" },
      }),
    );

    const head = must(card.querySelector<HTMLElement>(".omora-card-head"));
    expect(head.children[0]?.className).toBe("omora-card-title");
    expect(head.children[1]?.className).toBe("omora-card-meta");
    // 正文在 head 之后、媒体之前。
    expect(card.children[0]).toBe(head);
    expect(card.children[1]?.className).toBe("omora-card-text");
    expect(card.children[2]).toBe(media);
    expect(card.getAttribute("data-handler")).toBe("ideas:7:0");
    card.click();
    expect(mounted.events).toEqual([{ handler: "ideas:7:0", payload: {} }]);
    mounted.destroy();
  });
});

describe("生命周期", () => {
  const factories: Record<string, () => Node> = {
    empty: () => make("empty", { title: "空", hint: "提示" }),
    card: () => make("card", { title: "买牛奶", on_click: "ideas:8:0" }),
  };

  for (const [type, factory] of Object.entries(factories)) {
    it(type + " 卸载后从 DOM 移除", () => {
      const mounted = mountCards(factory());

      mounted.render(factory());
      mounted.destroy();

      expect(mounted.root.children).toHaveLength(0);
    });
  }
});

// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { SlotNode } from "../contract/document";
import { slotToNode } from "../renderer/slot_bridge";
import { mountSlot } from "./slot_registry";
import { fixtureWithInstantiatedFeed, mountNode, type RecordedSlotEvent } from "./test_fixtures";

function slot(over: Partial<SlotNode> & { id: string }): SlotNode {
  return { kind: "dendro:slot", owner: "test", props: {}, children: [], ...over };
}

describe("共享 document.json：渲染接入", () => {
  it("window 两栏：nav/page 两个 slot，page-link 带 aria-label / 图标", () => {
    const mounted = mountNode(slotToNode(fixtureWithInstantiatedFeed()));

    const windowEl = mounted.container.querySelector<HTMLElement>('[data-type="dendro:window"]');
    expect(windowEl?.className).toBe("omora-row");

    const [navSlot, pageSlot] = [...(windowEl?.children ?? [])];
    expect(navSlot?.className).toBe("omora-column");
    expect(navSlot?.getAttribute("data-flow")).toBe("column");
    expect(pageSlot?.className).toBe("omora-column");
    expect(pageSlot?.getAttribute("data-flow")).toBe("column");

    const link = navSlot?.querySelector<HTMLButtonElement>(".omora-page-link");
    expect(link?.getAttribute("aria-label")).toBe("灵感");
    expect(link?.title).toBe("灵感");
    expect(link?.querySelector("svg")?.getAttribute("data-icon")).toBe("ideas");
    expect(link?.dataset.handler).toBe("h0");
    mounted.destroy();
  });

  it("page.ideas 的 feed 物化后出现 .omora-card，bind 后的 title / meta 正确", () => {
    const mounted = mountNode(slotToNode(fixtureWithInstantiatedFeed()));

    const page = mounted.container.querySelector('[data-type="dendro:page"]');
    const feed = page?.querySelector('[data-type="dendro:slot"]');
    expect(feed?.getAttribute("data-flow")).toBe("column");

    const cards = feed?.querySelectorAll(".omora-card") ?? [];
    expect(cards).toHaveLength(1);
    expect(cards[0]?.querySelector(".omora-card-title")?.textContent).toBe("买牛奶");
    expect(cards[0]?.querySelector(".omora-card-meta")?.textContent).toBe("刚刚");
    mounted.destroy();
  });

  it("集合模板不进 DOM：只渲染物化后的实例，模板树一个节点都不多", () => {
    const mounted = mountNode(slotToNode(fixtureWithInstantiatedFeed()));

    const feed = mounted.container.querySelector(
      '[data-type="dendro:page"] [data-type="dendro:slot"]',
    );
    expect(feed?.querySelectorAll(".omora-card")).toHaveLength(1);
    expect(feed?.children).toHaveLength(1);
    mounted.destroy();
  });

  it("page-link click 经 ctx.event 发出 handler id", () => {
    const mounted = mountNode(slotToNode(fixtureWithInstantiatedFeed()));

    mounted.container.querySelector<HTMLButtonElement>(".omora-page-link")?.click();

    expect(mounted.events).toEqual([{ handler: "h0", payload: {} }]);
    mounted.destroy();
  });
});

describe("legacy 词表别名", () => {
  it("dendro:text / dendro:button 走 legacy 实现，事件同样回传", () => {
    const root = slotToNode(
      slot({
        id: "alias.root",
        layout: { flow: "column", capacity: "many" },
        children: [
          slot({ id: "alias.text", kind: "dendro:text", props: { text: "你好" } }),
          slot({
            id: "alias.button",
            kind: "dendro:button",
            props: { text: "按一下" },
            events: { click: "h3" },
          }),
        ],
      }),
    );
    const mounted = mountNode(root);

    expect(mounted.container.querySelector(".omora-text")?.textContent).toBe("你好");
    const button = mounted.container.querySelector<HTMLButtonElement>(".omora-button");
    expect(button?.textContent).toBe("按一下");
    button?.click();
    expect(mounted.events).toEqual([{ handler: "h3", payload: {} }]);
    mounted.destroy();
  });

  it("ideas:card 别名渲染成 legacy card", () => {
    const root = slotToNode(
      slot({
        id: "alias.root",
        layout: { flow: "column", capacity: "many" },
        children: [slot({ id: "alias.card", kind: "ideas:card", props: { title: "卡片" } })],
      }),
    );
    const mounted = mountNode(root);

    expect(mounted.container.querySelector(".omora-card-title")?.textContent).toBe("卡片");
    mounted.destroy();
  });
});

describe("渲染接入的其余约定", () => {
  it("未知 kind 走 renderer 占位，不抛", () => {
    const mounted = mountNode(slotToNode(slot({ id: "weird", kind: "nope:nope" })));

    expect(mounted.container.querySelector('[data-unknown-type="nope:nope"]')).not.toBeNull();
    mounted.destroy();
  });

  it("同一 root 引用再次 render 不重建元素", () => {
    const root = slotToNode(fixtureWithInstantiatedFeed());
    const mounted = mountNode(root);
    const windowBefore = mounted.container.querySelector('[data-type="dendro:window"]');
    const cardBefore = mounted.container.querySelector(".omora-card");

    mounted.render(root);

    expect(mounted.container.querySelector('[data-type="dendro:window"]')).toBe(windowBefore);
    expect(mounted.container.querySelector(".omora-card")).toBe(cardBefore);
    mounted.destroy();
  });

  it("mountSlot 助手把根树挂进容器，dispose 后清空", () => {
    const events: RecordedSlotEvent[] = [];
    const container = document.createElement("div");
    document.body.append(container);

    const renderer = mountSlot(fixtureWithInstantiatedFeed(), container, {
      event: (handler, payload) => events.push({ handler, payload }),
      loadMedia: () => Promise.resolve({ mime: "", data: "" }),
      cleanup: () => undefined,
    });

    expect(container.querySelector(".omora-card")).not.toBeNull();
    container.querySelector<HTMLButtonElement>(".omora-page-link")?.click();
    expect(events).toEqual([{ handler: "h0", payload: {} }]);
    renderer.dispose();
    expect(container.querySelector(".omora-card")).toBeNull();
    container.remove();
  });
});

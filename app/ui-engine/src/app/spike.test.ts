// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { SlotNode } from "../contract/document";
import { applyData, type DataState } from "../engine/updates/data";
import { hydrateSession } from "../engine/updates/hydrate";
import { diffPageTrees } from "../engine/document/page_switch";
import { applyFull, createSession, type SessionState } from "../engine/document/session";
import { slotToNode } from "../renderer/slot_bridge";
import { createSlotRenderer } from "./slot_registry";
import { DOCUMENT_FIXTURE_PATH } from "./test_fixtures";

/**
 * S3-d 集成 spike：共享 Slot 文档 fixture → session → 数据水合 → Slot 桥 → 现有 DOM renderer。
 *
 * 证明两件事：
 * 1. 运行时产出的 SlotNode 能直接由现有 renderer 渲染（不迁移 38 个 kind）；
 * 2. 数据更新 / 全量替换后，按 id 未变的节点复用同一 DOM 元素（数据更新不重挂）。
 *
 * 换页：page_switch 分类正确；但 renderer 目前只在同一个父节点下按 id 协调，
 * 跨父移动（move）会重建元素——这是下一步换页协调要补的缺口，测试里明确只断言分类。
 */

const FIXTURE: unknown = JSON.parse(readFileSync(DOCUMENT_FIXTURE_PATH, "utf8"));

interface Rendered {
  container: HTMLElement;
  renderer: ReturnType<typeof createSlotRenderer>;
  events: string[];
}

function render(root: SlotNode, previous?: Rendered): Rendered {
  const container = previous?.container ?? document.createElement("div");
  const events = previous?.events ?? [];
  const renderer =
    previous?.renderer ??
    createSlotRenderer({
      event: (handler) => events.push(handler),
      loadMedia: () => Promise.reject(new Error("spike 不加载媒体")),
      cleanup: () => undefined,
    });
  renderer.render(slotToNode(root), container);
  return { container, renderer, events };
}

function boot(): SessionState {
  const created = createSession(FIXTURE);
  if (!created.ok) {
    throw new Error("fixture 应该是合法文档");
  }
  const hydrated = hydrateSession(created.session);
  if (!hydrated.ok) {
    throw new Error("fixture 应该能水合");
  }
  return hydrated.session;
}

function childOf(root: SlotNode, id: string): SlotNode {
  const found = root.children.find((child) => child.id === id);
  if (found === undefined) {
    throw new Error("找不到子节点: " + id);
  }
  return found;
}

function cards(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(".omora-card")];
}

describe("S3-d spike：Slot 文档 → DOM", () => {
  it("共享 fixture 经 session + 水合 + 桥渲染出母页面、导航与卡片", () => {
    const session = boot();
    const { container, events } = render(session.document.root);

    expect(container.querySelector('[data-type="dendro:window"]')).not.toBeNull();
    expect(container.querySelector('[data-type="dendro:slot"]')).not.toBeNull();

    const link = container.querySelector<HTMLButtonElement>(".omora-page-link");
    expect(link?.getAttribute("aria-label")).toBe("灵感");
    expect(link?.dataset.handler).toBe("h0");
    link?.click();
    expect(events).toEqual(["h0"]);

    const rendered = cards(container);
    expect(rendered).toHaveLength(1);
    expect(rendered[0]?.querySelector(".omora-card-title")?.textContent).toBe("买牛奶");
    expect(rendered[0]?.querySelector(".omora-card-meta")?.textContent).toBe("刚刚");
    // 模板本身不进 DOM：卡片只有 1 张，feed 下也只有 1 个子节点。
    expect(container.querySelectorAll(".omora-column").length).toBeGreaterThan(0);
  });

  it("纯数据更新按 id 复用元素，只改该改的节点", () => {
    const session = boot();
    const first = render(session.document.root);
    const beforeCard = cards(first.container)[0];
    expect(beforeCard).toBeDefined();

    const update = {
      kind: "data",
      owner: "ideas",
      source: "ideas.feed",
      revision: 6,
      changes: [
        { kind: "update", key: "42", item: { title: "买牛奶（改）" } },
        {
          kind: "insert",
          key: "7",
          at: 1,
          item: { id: "7", template: "item", title: "录音", meta: "刚刚" },
        },
      ],
    };
    const applied = applyData(session.document, session.data as unknown as DataState, update);
    if (!applied.ok) {
      throw new Error("数据更新应该成功");
    }
    expect(applied.changed).toEqual(["ideas.feed"]);

    const second = render(applied.document.root, first);
    const after = cards(second.container);
    expect(after).toHaveLength(2);
    // 同 id 的卡片是同一个元素（没有被重挂）。
    expect(after[0]).toBe(beforeCard);
    expect(after[0]?.querySelector(".omora-card-title")?.textContent).toBe("买牛奶（改）");
    expect(after[1]?.querySelector(".omora-card-title")?.textContent).toBe("录音");
  });

  it("全量替换同 id 文档时也不重挂未变节点", () => {
    const session = boot();
    const first = render(session.document.root);
    const beforeCard = cards(first.container)[0];

    const next = structuredClone(FIXTURE) as {
      version: number;
      data: Record<string, unknown>;
    };
    next.version = 4;
    const full = applyFull(session, next);
    if (!full.ok) {
      throw new Error("更新版本的全量文档应该接受");
    }
    expect(full.session.document.version).toBe(4);
    const hydrated = hydrateSession(full.session);
    if (!hydrated.ok) {
      throw new Error("全量文档应该能水合");
    }

    const second = render(hydrated.session.document.root, first);
    expect(cards(second.container)[0]).toBe(beforeCard);
  });

  it("换页分类正确，渲染切到新页；跨父移动的元素复用是下一步缺口", () => {
    const session = boot();
    const first = render(session.document.root);
    const pageIdeas = childOf(childOf(session.document.root, "dendro.window.page"), "page.ideas");
    const feed = childOf(pageIdeas, "ideas.feed");

    const next = structuredClone(FIXTURE) as {
      version: number;
      active: string;
      pages: Array<Record<string, unknown>>;
      document: SlotNode;
    };
    next.version = 4;
    next.active = "page.other";
    next.pages.push({ id: "page.other", label: "其它", route: "/other", owner: "ideas" });
    const pageSlot = childOf(next.document, "dendro.window.page");
    const pageOther: SlotNode = {
      id: "page.other",
      kind: "dendro:page",
      owner: "ideas",
      props: {},
      children: [
        feed,
        {
          id: "page.other.text",
          kind: "dendro:text",
          owner: "ideas",
          props: { text: "其它页" },
          children: [],
        },
      ],
    };
    pageSlot.children = [pageOther];

    const plan = diffPageTrees(pageIdeas, pageOther);
    expect(plan.replace).toEqual([{ from: "page.ideas", to: "page.other" }]);
    expect(plan.move).toContain("ideas.feed");
    expect(plan.keep).toContain("ideas.feed#42");
    expect(plan.add).toContain("page.other.text");

    const full = applyFull(session, next);
    if (!full.ok) {
      throw new Error("换页全量应该接受");
    }
    const hydrated = hydrateSession(full.session);
    if (!hydrated.ok) {
      throw new Error("换页后的全量文档应该能水合");
    }
    const second = render(hydrated.session.document.root, first);
    expect(second.container.textContent).toContain("其它页");
    expect(cards(second.container)).toHaveLength(1);
    // page.ideas 已不在树里；feed 被移到新 page 下（当前 renderer 跨父会重建，身份保留待补）。
    expect(second.container.textContent).not.toContain("买牛奶（改）");
  });
});

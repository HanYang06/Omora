// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SlotNode } from "../core/document";
import type { Node } from "../core/types";
import { hydrateSession } from "../runtime/hydrate";
import { applyFull, createSession } from "../runtime/session";
import { registry } from "./registry";
import { DomRenderer } from "./renderer";
import type { Kind, KindRegistry, RenderContext } from "./types";
import { slotToNode } from "./slot/bridge";
import { createSlotRenderer } from "./slot/registry";
import { findById, readDocumentFixture } from "./slot/test_fixtures";

/**
 * 跨父 move 的行为测试：同一 id + 同 type 换父 / 换槽时复用同一个 DOM 元素，
 * 只删该删的、只清该清的；无 id 节点、memo、失败隔离维持旧规则。
 */

function node(
  type: string,
  children: Node[] = [],
  props: Record<string, unknown> = {},
  id?: string,
): Node {
  const result: Node = { type, props, children };
  if (id !== undefined) {
    result.id = id;
  }
  return result;
}

function text(value: string, id?: string): Node {
  return node("text", [], { text: value }, id);
}

function column(children: Node[], id?: string): Node {
  return node("column", children, {}, id);
}

function split(children: Node[], id?: string): Node {
  return node("split", children, {}, id);
}

function probe(id: string, label = id, children: Node[] = []): Node {
  return node("probe", children, { label }, id);
}

function labelOf(entry: Node): string {
  const value = entry.props.label;
  return typeof value === "string" ? value : "";
}

interface ProbeOptions {
  log?: string[];
  failCreate?: ReadonlySet<string>;
  failUpdate?: ReadonlySet<string>;
}

/** 可观测的测试 kind：create 登记 cleanup、destroy 记账，可按 id 注入失败。 */
function probeKinds(options: ProbeOptions = {}): KindRegistry {
  const log = options.log ?? [];
  const failCreate = options.failCreate ?? new Set<string>();
  const failUpdate = options.failUpdate ?? new Set<string>();
  const probeKind: Kind = {
    create(entry, ctx) {
      const id = entry.id ?? "";
      if (failCreate.has(id)) {
        throw new Error("probe create 失败: " + id);
      }
      const el = document.createElement("div");
      el.className = "probe";
      el.dataset.type = "probe";
      el.dataset.probe = id;
      el.textContent = labelOf(entry);
      ctx.cleanup(() => log.push("cleanup:" + id));
      return el;
    },
    update(el, entry) {
      const id = entry.id ?? "";
      if (failUpdate.has(id)) {
        throw new Error("probe update 失败: " + id);
      }
      el.textContent = labelOf(entry);
    },
    destroy(el) {
      log.push("destroy:" + (el.dataset.probe ?? ""));
    },
  };
  return { ...registry, probe: probeKind };
}

interface Harness {
  container: HTMLElement;
  render(node: Node): void;
  dispose(): void;
}

const open: Harness[] = [];
const disposers: (() => void)[] = [];

function harness(kinds: KindRegistry = registry): Harness {
  const context: RenderContext = {
    event: () => undefined,
    loadMedia: () => Promise.resolve({ mime: "", data: "" }),
    cleanup: () => undefined,
  };
  const container = document.createElement("div");
  document.body.append(container);
  const renderer = new DomRenderer({ registry: kinds, context });
  const mounted: Harness = {
    container,
    render: (next) => renderer.render(next, container),
    dispose: () => {
      renderer.dispose();
      container.remove();
    },
  };
  open.push(mounted);
  return mounted;
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const dispose of disposers.splice(0)) {
    dispose();
  }
  for (const mounted of open.splice(0)) {
    mounted.dispose();
  }
});

function childAt(parent: Element, index: number): HTMLElement {
  const child = parent.children[index];
  if (child === undefined) {
    throw new Error("没有第 " + String(index) + " 个子元素");
  }
  return child as HTMLElement;
}

describe("跨父 move：按 id 复用元素", () => {
  it("同 id + 同 type 换父：元素不变、旧父摘掉、新父挂上", () => {
    const h = harness();
    h.render(column([column([text("甲", "a")], "left"), column([], "right")]));
    const rootEl = childAt(h.container, 0);
    const leftEl = childAt(rootEl, 0);
    const rightEl = childAt(rootEl, 1);
    const moved = childAt(leftEl, 0);
    expect(moved.textContent).toBe("甲");

    h.render(column([column([], "left"), column([text("乙", "a")], "right")]));

    expect(childAt(rightEl, 0)).toBe(moved);
    expect(moved.textContent).toBe("乙");
    expect(leftEl.children).toHaveLength(0);
    expect(h.container.firstElementChild).toBe(rootEl);
  });

  it("整棵子树换父：子树里每个元素都复用", () => {
    const h = harness();
    h.render(column([column([column([text("甲", "t")], "feed")], "left"), column([], "right")]));
    const rootEl = childAt(h.container, 0);
    const leftEl = childAt(rootEl, 0);
    const rightEl = childAt(rootEl, 1);
    const feedEl = childAt(leftEl, 0);
    const textEl = childAt(feedEl, 0);

    h.render(column([column([], "left"), column([column([text("乙", "t")], "feed")], "right")]));

    expect(childAt(rightEl, 0)).toBe(feedEl);
    expect(childAt(feedEl, 0)).toBe(textEl);
    expect(textEl.textContent).toBe("乙");
    expect(leftEl.children).toHaveLength(0);
  });

  it("同一批 move + 重排 + 删除 + 新增：cleanup 只跑该跑的", () => {
    const log: string[] = [];
    const h = harness(probeKinds({ log }));
    h.render(column([column([probe("move"), probe("dead")], "left"), probe("keep")]));
    const rootEl = childAt(h.container, 0);
    const leftEl = childAt(rootEl, 0);
    const moved = childAt(leftEl, 0);
    const dead = childAt(leftEl, 1);
    const keep = childAt(rootEl, 1);
    log.length = 0;

    h.render(column([probe("keep", "k2"), column([probe("move", "m2")], "right"), probe("fresh")]));

    const rightEl = childAt(rootEl, 1);
    expect(childAt(rootEl, 0)).toBe(keep);
    expect(childAt(rightEl, 0)).toBe(moved);
    expect(moved.textContent).toBe("m2");
    expect(childAt(rootEl, 2).dataset.probe).toBe("fresh");
    expect(leftEl.parentElement).toBeNull();
    expect(dead.parentElement).toBeNull();
    expect(log.filter((entry) => entry === "destroy:dead")).toHaveLength(1);
    expect(log.filter((entry) => entry === "cleanup:dead")).toHaveLength(1);
    expect(log.filter((entry) => entry.includes("move"))).toHaveLength(0);
    expect(log.filter((entry) => entry.includes("keep"))).toHaveLength(0);

    log.length = 0;
    h.dispose();
    expect(log.filter((entry) => entry === "cleanup:move")).toHaveLength(1);
    expect(log.filter((entry) => entry === "cleanup:keep")).toHaveLength(1);
    expect(log.filter((entry) => entry === "cleanup:fresh")).toHaveLength(1);
  });

  it("node 引用不变的子树跳过 update，但元素仍挂到新 host", () => {
    const update = vi.fn();
    const memoKind: Kind = {
      create() {
        const el = document.createElement("div");
        el.className = "memo";
        el.dataset.type = "memo";
        return el;
      },
      update,
    };
    const h = harness({ ...registry, memo: memoKind });
    const subtree = node("memo", [], {}, "m");
    h.render(column([column([subtree], "left"), column([], "right")]));
    const rootEl = childAt(h.container, 0);
    const rightEl = childAt(rootEl, 1);
    const memoEl = childAt(childAt(rootEl, 0), 0);
    update.mockClear();

    h.render(column([column([], "left"), column([subtree], "right")]));

    expect(update).not.toHaveBeenCalled();
    expect(childAt(rightEl, 0)).toBe(memoEl);
  });
});

describe("childrenHosts 多槽 kind", () => {
  it("子节点换到另一个槽：元素复用、按新 host 重排", () => {
    const h = harness();
    h.render(split([text("甲", "a"), text("乙", "b")]));
    const rootEl = childAt(h.container, 0);
    const side = rootEl.querySelector(".omora-split-side");
    const main = rootEl.querySelector(".omora-split-main");
    expect(side).not.toBeNull();
    expect(main).not.toBeNull();
    if (side === null || main === null) {
      throw new Error("split 缺少槽");
    }
    const a = firstOf(side);
    const b = firstOf(main);

    h.render(split([text("乙", "b"), text("甲", "a")]));

    expect(firstOf(side)).toBe(b);
    expect(b.textContent).toBe("乙");
    expect(firstOf(main)).toBe(a);
    expect(a.textContent).toBe("甲");
    expect(side.children).toHaveLength(1);
    expect(main.children).toHaveLength(1);
  });
});

function firstOf(parent: Element): HTMLElement {
  return childAt(parent, 0);
}

describe("重建与身份", () => {
  it("跨父移动后 type 变了：换元素并销毁旧的", () => {
    const log: string[] = [];
    const h = harness(probeKinds({ log }));
    h.render(column([column([probe("x", "旧")], "left"), column([], "right")]));
    const rootEl = childAt(h.container, 0);
    const leftEl = childAt(rootEl, 0);
    const rightEl = childAt(rootEl, 1);
    const before = childAt(leftEl, 0);
    log.length = 0;

    h.render(column([column([], "left"), column([text("新", "x")], "right")]));

    const after = childAt(rightEl, 0);
    expect(after).not.toBe(before);
    expect(after.dataset.type).toBe("text");
    expect(after.textContent).toBe("新");
    expect(leftEl.children).toHaveLength(0);
    expect(before.parentElement).toBeNull();
    expect(log.filter((entry) => entry === "destroy:x")).toHaveLength(1);
    expect(log.filter((entry) => entry === "cleanup:x")).toHaveLength(1);
  });

  it("根 key（有 id）或 type 变了：换根并销毁旧树", () => {
    const log: string[] = [];
    const h = harness(probeKinds({ log }));
    h.render(column([probe("x")], "r1"));
    const firstRoot = childAt(h.container, 0);
    const firstProbe = childAt(firstRoot, 0);
    log.length = 0;

    h.render(column([probe("x")], "r2"));

    const secondRoot = childAt(h.container, 0);
    expect(secondRoot).not.toBe(firstRoot);
    expect(firstRoot.parentElement).toBeNull();
    expect(firstProbe.parentElement).toBeNull();
    expect(childAt(secondRoot, 0)).not.toBe(firstProbe);
    expect(log.filter((entry) => entry === "destroy:x")).toHaveLength(1);

    h.render(node("row", [probe("x")]));

    const thirdRoot = childAt(h.container, 0);
    expect(thirdRoot.dataset.type).toBe("row");
    expect(h.container.children).toHaveLength(1);
    expect(secondRoot.parentElement).toBeNull();
  });

  it("同一轮里重复 id 只复用一次旧元素", () => {
    const h = harness();
    h.render(column([text("甲", "dup")]));
    const rootEl = childAt(h.container, 0);
    const first = childAt(rootEl, 0);

    h.render(column([text("乙", "dup"), text("丙", "dup")]));

    expect(childAt(rootEl, 0)).toBe(first);
    expect(first.textContent).toBe("乙");
    const second = childAt(rootEl, 1);
    expect(second).not.toBe(first);
    expect(second.textContent).toBe("丙");

    h.render(column([text("乙", "dup"), text("丙", "dup")]));

    expect(rootEl.children).toHaveLength(2);
    expect(childAt(rootEl, 0)).toBe(first);
    expect(childAt(rootEl, 1)).not.toBe(second);
  });

  it("无 id 节点按父路径 + 位置复用，换父就重建", () => {
    const h = harness();
    h.render(column([text("甲")]));
    const rootEl = childAt(h.container, 0);
    const first = childAt(rootEl, 0);

    h.render(column([text("乙")]));
    expect(childAt(rootEl, 0)).toBe(first);
    expect(first.textContent).toBe("乙");

    h.render(column([column([text("甲")], "left"), column([], "right")]));
    const leftEl = childAt(rootEl, 0);
    const rightEl = childAt(rootEl, 1);
    const inLeft = childAt(leftEl, 0);

    h.render(column([column([], "left"), column([text("乙")], "right")]));
    const inRight = childAt(rightEl, 0);
    expect(inRight).not.toBe(inLeft);
    expect(inRight.textContent).toBe("乙");
    expect(leftEl.children).toHaveLength(0);
  });

  it("kind create / update 失败：换占位或重建，不抛也不连累兄弟", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const h = harness(probeKinds({ failCreate: new Set(["bad"]), failUpdate: new Set(["later"]) }));

    expect(() => h.render(column([probe("bad"), text("兄弟", "s"), probe("later")]))).not.toThrow();
    const rootEl = childAt(h.container, 0);
    expect(childAt(rootEl, 0).dataset.failed).toBe("true");
    expect(childAt(rootEl, 1).textContent).toBe("兄弟");
    const later = childAt(rootEl, 2);

    expect(() =>
      h.render(column([probe("bad"), text("兄弟2", "s"), probe("later", "新")])),
    ).not.toThrow();

    expect(childAt(h.container, 0)).toBe(rootEl);
    expect(childAt(rootEl, 0).dataset.failed).toBe("true");
    expect(childAt(rootEl, 1).textContent).toBe("兄弟2");
    expect(childAt(rootEl, 2)).not.toBe(later);
    expect(childAt(rootEl, 2).textContent).toBe("新");
  });
});

describe("dispose", () => {
  it("清理整棵树：嵌套条目的 destroy 与 cleanup 都跑，移动过的不重复", () => {
    const log: string[] = [];
    const mounted = harness(probeKinds({ log }));
    mounted.render(column([probe("outer", "o", [probe("inner", "i")])]));
    const rootEl = childAt(mounted.container, 0);
    log.length = 0;

    mounted.dispose();

    expect(log).toEqual(["destroy:inner", "cleanup:inner", "destroy:outer", "cleanup:outer"]);
    expect(mounted.container.children).toHaveLength(0);
    expect(rootEl.parentElement).toBeNull();
  });
});
describe("Slot 换页 move：跨页保留实例", () => {
  it("换页后同一张卡片的 DOM 元素被复用，旧页消失", () => {
    const fixture = readDocumentFixture();
    const created = createSession(fixture);
    if (!created.ok) {
      throw new Error("fixture 应该是合法文档");
    }
    const hydrated = hydrateSession(created.session);
    if (!hydrated.ok) {
      throw new Error("fixture 应该能水合");
    }
    const session = hydrated.session;
    const container = document.createElement("div");
    document.body.append(container);
    const renderer = createSlotRenderer({
      event: () => undefined,
      loadMedia: () => Promise.reject(new Error("测试不加载媒体")),
      cleanup: () => undefined,
    });
    disposers.push(() => {
      renderer.dispose();
      container.remove();
    });
    renderer.render(slotToNode(session.document.root), container);

    const card = container.querySelector<HTMLElement>(".omora-card");
    if (card === null) {
      throw new Error("第一页应该有卡片");
    }
    const feed = card.parentElement;
    if (feed === null) {
      throw new Error("卡片应该挂在 feed 下");
    }

    const next = structuredClone(fixture) as {
      version: number;
      active: string;
      pages: Array<Record<string, unknown>>;
      document: SlotNode;
    };
    next.version = 4;
    next.active = "page.other";
    next.pages.push({ id: "page.other", label: "其它", route: "/other", owner: "ideas" });
    const pageSlot = findById(next.document, "dendro.window.page");
    const pageIdeas = findById(next.document, "page.ideas");
    const movedFeed = pageIdeas === undefined ? undefined : findById(pageIdeas, "ideas.feed");
    if (pageSlot === undefined || movedFeed === undefined) {
      throw new Error("fixture 应有 page slot 与 ideas.feed");
    }
    pageSlot.children = [
      {
        id: "page.other",
        kind: "dendro:page",
        owner: "ideas",
        props: {},
        children: [
          movedFeed,
          {
            id: "page.other.text",
            kind: "dendro:text",
            owner: "ideas",
            props: { text: "其它页" },
            children: [],
          },
        ],
      },
    ];

    const full = applyFull(session, next);
    if (!full.ok) {
      throw new Error("换页全量应该接受");
    }
    const moved = hydrateSession(full.session);
    if (!moved.ok) {
      throw new Error("换页后的全量文档应该能水合");
    }
    renderer.render(slotToNode(moved.session.document.root), container);

    const cardsAfter = [...container.querySelectorAll<HTMLElement>(".omora-card")];
    expect(cardsAfter).toHaveLength(1);
    expect(cardsAfter[0]).toBe(card);
    expect(container.textContent).toContain("其它页");
    expect(container.querySelectorAll('[data-type="dendro:page"]')).toHaveLength(1);
    expect(container.querySelector('[data-type="dendro:page"]')?.contains(feed)).toBe(true);
  });
});

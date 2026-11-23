// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { Document, Node } from "../../../src/contract/tree_generated";
import type { Kind, KindRegistry, RenderContext } from "../../../src/renderer/types";
import { treeKinds } from "../../../src/components/tree_kinds";
import { mountTreeDocument } from "../../../src/app/tree/tree_renderer";

const ROOT = "aaaaaaaaaaaaaaaa";
const PAGE = "bbbbbbbbbbbbbbbb";
const FEED = "cccccccccccccccc";
const TEMPLATE = "dddddddddddddddd";

function node(
  id: string,
  chain: string,
  kind: string,
  order: number,
  over: Partial<Node> = {},
): Node {
  return {
    id,
    chain,
    kind,
    order,
    layout: [],
    settings: {},
    bind: {},
    on: {},
    emit: {},
    ...over,
  };
}

function feedNode(): Node {
  return node(FEED, ROOT + "." + PAGE + "." + FEED, "column", 10, {
    collection: {
      source: "ideas.feed",
      key: "id",
      select: "template",
      templates: {
        item: node(TEMPLATE, ROOT + "." + PAGE + "." + FEED + "." + TEMPLATE, "text", 10, {
          settings: { text: "占位" },
          bind: { text: "item.title" },
        }),
      },
    },
  });
}

function docOf(items: Record<string, unknown>[], version = 1): Document {
  return {
    schema: "dendro.tree/1",
    version,
    root: node(ROOT, ROOT, "app", 0, {
      layout: [node(PAGE, ROOT + "." + PAGE, "column", 10, { layout: [feedNode()] })],
    }),
    pages: [{ id: PAGE, title: "灵感", route: "/ideas" }],
    active: PAGE,
    data: { "ideas.feed": { revision: version, items } },
  };
}

function context(): RenderContext {
  return {
    event: () => undefined,
    loadMedia: () => Promise.reject(new Error("测试不加载媒体")),
    cleanup: () => undefined,
  };
}

function mount(documentValue: Document): {
  container: HTMLElement;
  runtime: ReturnType<typeof mountTreeDocument>;
} {
  const container = document.createElement("div");
  document.body.append(container);
  const runtime = mountTreeDocument(container, documentValue, context());
  return { container, runtime };
}

function texts(container: HTMLElement): string[] {
  return [...container.querySelectorAll<HTMLElement>('[data-type="text"]')].map(
    (el) => el.textContent ?? "",
  );
}

describe("V1 collection 挂载期实例化", () => {
  it("按 items 展开模板，bind 解析进 props", () => {
    const { container, runtime } = mount(
      docOf([
        { id: "a", template: "item", title: "甲" },
        { id: "b", template: "item", title: "乙" },
      ]),
    );

    expect(texts(container)).toEqual(["甲", "乙"]);
    runtime.dispose();
    container.remove();
  });

  it("replace 按 key 复用实例：同 key 保留元素，新 key 挂载，旧 key 卸载", () => {
    const first = mount(
      docOf([
        { id: "a", template: "item", title: "甲" },
        { id: "b", template: "item", title: "乙" },
      ]),
    );
    const before = first.container.querySelectorAll<HTMLElement>('[data-type="text"]');
    const elementA = before[0];
    const elementB = before[1];

    const replaced = first.runtime.replace(
      docOf(
        [
          { id: "a", template: "item", title: "甲改" },
          { id: "c", template: "item", title: "丙" },
        ],
        2,
      ),
    );

    expect(replaced.ok).toBe(true);
    const after = first.container.querySelectorAll<HTMLElement>('[data-type="text"]');
    expect(after[0]).toBe(elementA);
    expect(after[0]?.textContent).toBe("甲改");
    expect(after[1]?.textContent).toBe("丙");
    expect([...after].includes(elementB as HTMLElement)).toBe(false);

    first.runtime.dispose();
    first.container.remove();
  });

  it("data op 按 key 增量 reconcile：同 key 复用、新 key 挂载、旧 key 卸载、顺序跟随数据", () => {
    const { container, runtime } = mount(
      docOf([
        { id: "a", template: "item", title: "甲" },
        { id: "b", template: "item", title: "乙" },
      ]),
    );
    const before = [...container.querySelectorAll<HTMLElement>('[data-type="text"]')];
    const elementA = before[0];
    const elementB = before[1];

    const result = runtime.applyOps({
      kind: "ops",
      document: 2,
      base: 1,
      seq: 1,
      ops: [
        {
          op: "data",
          source: "ideas.feed",
          revision: 2,
          items: [
            { id: "b", template: "item", title: "乙改" },
            { id: "c", template: "item", title: "丙" },
          ],
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.ok ? result.changed : []).toEqual([]);
    const after = [...container.querySelectorAll<HTMLElement>('[data-type="text"]')];
    expect(after.map((el) => el.textContent)).toEqual(["乙改", "丙"]);
    expect(after[0]).toBe(elementB);
    expect(after.includes(elementA as HTMLElement)).toBe(false);

    runtime.dispose();
    container.remove();
  });

  it("data op 只换顺序时移动已有元素，不重建", () => {
    const { container, runtime } = mount(
      docOf([
        { id: "a", template: "item", title: "甲" },
        { id: "b", template: "item", title: "乙" },
      ]),
    );
    const [elementA, elementB] = [...container.querySelectorAll<HTMLElement>('[data-type="text"]')];

    const result = runtime.applyOps({
      kind: "ops",
      document: 2,
      base: 1,
      seq: 2,
      ops: [
        {
          op: "data",
          source: "ideas.feed",
          revision: 2,
          items: [
            { id: "b", template: "item", title: "乙" },
            { id: "a", template: "item", title: "甲" },
          ],
        },
      ],
    });

    expect(result.ok).toBe(true);
    const after = [...container.querySelectorAll<HTMLElement>('[data-type="text"]')];
    expect(after.map((el) => el.textContent)).toEqual(["乙", "甲"]);
    expect(after[0]).toBe(elementB);
    expect(after[1]).toBe(elementA);

    runtime.dispose();
    container.remove();
  });

  it("坏条目只丢自己并记 E-TEMPLATE / E-ID-DUPLICATE", () => {
    const { container, runtime } = mount(
      docOf([
        { id: "a", template: "item", title: "甲" },
        { template: "item", title: "缺 key" },
        { id: "b", template: "不存在", title: "坏模板" },
        { id: "a", template: "item", title: "重复" },
        { id: "c", template: "item", title: "丙" },
      ]),
    );

    expect(texts(container)).toEqual(["甲", "丙"]);
    const codes = runtime.diagnostics.map((diagnostic) => diagnostic.code);
    expect(codes).toContain("E-TEMPLATE");
    expect(codes).toContain("E-ID-DUPLICATE");

    runtime.dispose();
    container.remove();
  });

  it("virtual collection 把 items 投影给 kind，data op 触发 update", () => {
    const seen: unknown[] = [];
    const probe: Kind = {
      create(node) {
        const el = document.createElement("div");
        el.dataset.type = "probe";
        seen.push(node.props.items);
        el.textContent = String((node.props.items as unknown[]).length);
        return el;
      },
      update(el, node) {
        seen.push(node.props.items);
        el.textContent = String((node.props.items as unknown[]).length);
      },
      childrenHosts: () => null,
    };
    const documentValue: Document = {
      schema: "dendro.tree/1",
      version: 1,
      root: node(ROOT, ROOT, "app", 0, {
        layout: [
          node(PAGE, ROOT + "." + PAGE, "column", 10, {
            layout: [
              node(FEED, ROOT + "." + PAGE + "." + FEED, "probe", 10, {
                collection: { source: "virtual.items", key: "id", virtual: true },
              }),
            ],
          }),
        ],
      }),
      pages: [{ id: PAGE, title: "灵感", route: "/ideas" }],
      active: PAGE,
      data: {
        "virtual.items": {
          revision: 1,
          items: [
            { id: "a", title: "甲" },
            { id: "b", title: "乙" },
          ],
        },
      },
    };
    const container = document.createElement("div");
    document.body.append(container);
    const runtime = mountTreeDocument(container, documentValue, context(), {
      ...treeKinds,
      probe,
    });

    const el = container.querySelector<HTMLElement>('[data-type="probe"]');
    expect(el?.textContent).toBe("2");
    expect((seen[0] as unknown[]).length).toBe(2);

    const result = runtime.applyOps({
      kind: "ops",
      document: 2,
      base: 1,
      seq: 1,
      ops: [
        {
          op: "data",
          source: "virtual.items",
          revision: 2,
          items: [
            { id: "a", title: "甲" },
            { id: "b", title: "乙" },
            { id: "c", title: "丙" },
          ],
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(el?.textContent).toBe("3");
    expect((seen.at(-1) as unknown[]).length).toBe(3);

    runtime.dispose();
    container.remove();
  });

  it("没有 data 时 collection 不产生条目", () => {
    const documentValue = docOf([]);
    documentValue.data = {};
    const { container, runtime } = mount(documentValue);

    expect(texts(container)).toEqual([]);
    expect(runtime.diagnostics).toEqual([]);

    runtime.dispose();
    container.remove();
  });
});
/* ------------------------------------------------------------------ */
/* data op 的 DOM 步长：只碰变化的那一条                                  */
/* ------------------------------------------------------------------ */

const SOURCE = "ideas.feed";
const CARD = "eeeeeeeeeeeeeeee";
const TITLE = "ffffffffffffffff";

function cardTemplate(): Node {
  const chain = ROOT + "." + PAGE + "." + FEED + "." + CARD;
  return node(CARD, chain, "card", 10, {
    settings: { title: "占位" },
    bind: { title: "item.title" },
    on: { click: "open-item" },
    layout: [
      node(TITLE, chain + "." + TITLE, "text", 10, {
        settings: { text: "占位" },
        bind: { text: "item.title" },
      }),
    ],
  });
}

/** 一页只有一个 collection；items 全量进 data。 */
function feedDocOf(template: Node, items: Record<string, unknown>[], version = 1): Document {
  return {
    schema: "dendro.tree/1",
    version,
    root: node(ROOT, ROOT, "app", 0, {
      layout: [
        node(PAGE, ROOT + "." + PAGE, "column", 10, {
          layout: [
            node(FEED, ROOT + "." + PAGE + "." + FEED, "column", 10, {
              collection: {
                source: SOURCE,
                key: "id",
                select: "template",
                templates: { item: template },
              },
            }),
          ],
        }),
      ],
    }),
    pages: [{ id: PAGE, title: "灵感", route: "/ideas" }],
    active: PAGE,
    data: { [SOURCE]: { revision: version, items } },
  };
}

function cardItems(count: number, changedIndex = -1): Record<string, unknown>[] {
  return Array.from({ length: count }, (_value, index) => ({
    id: "k" + String(index),
    template: "item",
    title: index === changedIndex ? "条目 " + String(index) + " 改" : "条目 " + String(index),
  }));
}

function elementsById(container: HTMLElement): Map<string, HTMLElement> {
  const found = new Map<string, HTMLElement>();
  for (const element of container.querySelectorAll<HTMLElement>("[data-node-id]")) {
    const id = element.dataset.nodeId;
    if (id !== undefined) {
      found.set(id, element);
    }
  }
  return found;
}

/** 记录 kind.update 的注册表：update 是适配器碰到组件的可观察边界。 */
function countingKinds(updatedIds: string[]): KindRegistry {
  const track = (kind: Kind): Kind => {
    const childrenHosts = kind.childrenHosts;
    return {
      create(node, ctx) {
        return kind.create(node, ctx);
      },
      update(el, node, ctx) {
        updatedIds.push(node.id ?? "");
        kind.update?.(el, node, ctx);
      },
      destroy(el) {
        kind.destroy?.(el);
      },
      childrenHosts:
        childrenHosts === undefined ? undefined : (el, node) => childrenHosts(el, node),
    };
  };
  const card = treeKinds.card;
  const text = treeKinds.text;
  if (card === undefined || text === undefined) {
    throw new Error("treeKinds 缺少 card / text");
  }
  return { ...treeKinds, card: track(card), text: track(text) };
}

interface CardStep {
  readonly updatedIds: string[];
  readonly reused: boolean;
  readonly changedText: string | undefined;
  readonly unchangedText: string | undefined;
  readonly diagnostics: string[];
}

/** 挂 N 条 card 实例，只改第 42 条，量一次 data op 碰了多少组件 / DOM。 */
function measureCardStep(count: number): CardStep {
  const updatedIds: string[] = [];
  const container = document.createElement("div");
  document.body.append(container);
  const runtime = mountTreeDocument(
    container,
    feedDocOf(cardTemplate(), cardItems(count)),
    context(),
    countingKinds(updatedIds),
  );
  const before = elementsById(container);

  const result = runtime.applyOps({
    kind: "ops",
    document: 2,
    base: 1,
    seq: 1,
    ops: [{ op: "data", source: SOURCE, revision: 2, items: cardItems(count, 42) }],
  });
  expect(result.ok).toBe(true);

  const after = elementsById(container);
  const reused =
    before.size === after.size && [...before].every(([id, element]) => after.get(id) === element);
  const step: CardStep = {
    updatedIds,
    reused,
    changedText: after.get(FEED + "#k42/" + TITLE)?.textContent ?? undefined,
    unchangedText: after.get(FEED + "#k0/" + TITLE)?.textContent ?? undefined,
    diagnostics: runtime.diagnostics.map((diagnostic) => diagnostic.code),
  };
  runtime.dispose();
  container.remove();
  return step;
}

describe("data op 的 DOM 步长：只碰变化的那一条", () => {
  it("N=100 与 N=800 的更新数相同；未变条目元素复用，变化条目的正文跟着更新", () => {
    const small = measureCardStep(100);
    const large = measureCardStep(800);

    const changed = FEED + "#k42";
    const expected = new Set([changed, changed + "/" + TITLE]);
    expect(new Set(small.updatedIds)).toEqual(expected);
    expect(new Set(large.updatedIds)).toEqual(expected);
    expect(small.reused).toBe(true);
    expect(large.reused).toBe(true);
    expect(small.changedText).toBe("条目 42 改");
    expect(small.unchangedText).toBe("条目 0");
    expect(small.diagnostics).toEqual([]);
    expect(large.diagnostics).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* 集合实例 key 进事件 payload                                           */
/* ------------------------------------------------------------------ */

interface CapturedEvent {
  readonly handler: string;
  readonly payload?: Record<string, unknown>;
}

function eventContext(events: CapturedEvent[]): RenderContext {
  return {
    event: (handler, payload) => events.push({ handler, payload }),
    loadMedia: () => Promise.reject(new Error("测试不加载媒体")),
    cleanup: () => undefined,
  };
}

function mountWith(
  documentValue: Document,
  events: CapturedEvent[],
  kinds: KindRegistry = treeKinds,
): { container: HTMLElement; runtime: ReturnType<typeof mountTreeDocument> } {
  const container = document.createElement("div");
  document.body.append(container);
  const runtime = mountTreeDocument(container, documentValue, eventContext(events), kinds);
  return { container, runtime };
}

function itemList(keys: string[]): Record<string, unknown>[] {
  return keys.map((key) => ({ id: key, template: "item", title: key }));
}

describe("集合实例的事件 payload", () => {
  it("点击集合实例：payload.item 是这一条实例的 key", () => {
    const events: CapturedEvent[] = [];
    const { container, runtime } = mountWith(
      feedDocOf(cardTemplate(), itemList(["a", "b"])),
      events,
    );

    const cards = [...container.querySelectorAll<HTMLElement>('[data-type="card"]')];
    expect(cards.length).toBe(2);
    cards[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(events).toEqual([{ handler: "open-item", payload: { item: "b" } }]);
    runtime.dispose();
    container.remove();
  });

  it("模板里嵌套节点的事件也带同一条实例的 key", () => {
    const events: CapturedEvent[] = [];
    const chain = ROOT + "." + PAGE + "." + FEED + "." + CARD;
    const template = node(CARD, chain, "column", 10, {
      layout: [
        node(TITLE, chain + "." + TITLE, "card", 10, {
          settings: { title: "点我" },
          on: { click: "open-item" },
        }),
      ],
    });
    const { container, runtime } = mountWith(feedDocOf(template, itemList(["a", "b"])), events);

    const cards = [...container.querySelectorAll<HTMLElement>('[data-type="card"]')];
    cards[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(events).toEqual([{ handler: "open-item", payload: { item: "b" } }]);
    runtime.dispose();
    container.remove();
  });

  it("非实例节点的事件 payload 不带 item", () => {
    const events: CapturedEvent[] = [];
    const plain = node(CARD, ROOT + "." + PAGE + "." + CARD, "card", 10, {
      settings: { title: "单张" },
      on: { click: "open-plain" },
    });
    const documentValue: Document = {
      schema: "dendro.tree/1",
      version: 1,
      root: node(ROOT, ROOT, "app", 0, {
        layout: [node(PAGE, ROOT + "." + PAGE, "column", 10, { layout: [plain] })],
      }),
      pages: [{ id: PAGE, title: "灵感", route: "/ideas" }],
      active: PAGE,
      data: {},
    };
    const { container, runtime } = mountWith(documentValue, events);

    container
      .querySelector<HTMLElement>('[data-type="card"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(events).toEqual([{ handler: "open-plain", payload: {} }]);
    runtime.dispose();
    container.remove();
  });

  it("调用方 payload 里已有 item：保留调用方的值", () => {
    const events: CapturedEvent[] = [];
    const probe: Kind = {
      create(_node, ctx) {
        const el = document.createElement("button");
        el.dataset.type = "probe";
        el.addEventListener("click", () => ctx.event("probe", { item: "caller", value: "自带" }));
        return el;
      },
      childrenHosts: () => null,
    };
    const template = node(TEMPLATE, ROOT + "." + PAGE + "." + FEED + "." + TEMPLATE, "probe", 10);
    const { container, runtime } = mountWith(feedDocOf(template, itemList(["a"])), events, {
      ...treeKinds,
      probe,
    });

    container.querySelector<HTMLElement>('[data-type="probe"]')?.click();

    expect(events).toEqual([{ handler: "probe", payload: { item: "caller", value: "自带" } }]);
    runtime.dispose();
    container.remove();
  });

  it("input 已有的 value 字段保留，item 一道带上", () => {
    const events: CapturedEvent[] = [];
    const template = node(TEMPLATE, ROOT + "." + PAGE + "." + FEED + "." + TEMPLATE, "input", 10, {
      on: { submit: "capture" },
    });
    const { container, runtime } = mountWith(feedDocOf(template, itemList(["a", "b"])), events);

    const fields = [...container.querySelectorAll<HTMLInputElement>(".omora-capture-input")];
    const field = fields[1];
    if (field === undefined) {
      throw new Error("没有第二个 input");
    }
    field.value = "新灵感";
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(events).toEqual([{ handler: "capture", payload: { value: "新灵感", item: "b" } }]);
    runtime.dispose();
    container.remove();
  });
});
/* ------------------------------------------------------------------ */
/* 集合重排：批量提交 + 最小 DOM 移动                                    */
/* ------------------------------------------------------------------ */

function hostOf(container: HTMLElement): HTMLElement {
  const host = container.querySelector<HTMLElement>('[data-node-id="' + FEED + '"]');
  if (host === null) {
    throw new Error("找不到 collection 宿主");
  }
  return host;
}

function childIds(host: HTMLElement): string[] {
  return [...host.children].map((el) => (el as HTMLElement).dataset.nodeId ?? "?");
}

function childElements(host: HTMLElement): Map<string, HTMLElement> {
  const found = new Map<string, HTMLElement>();
  for (const el of host.children) {
    const element = el as HTMLElement;
    const id = element.dataset.nodeId;
    if (id !== undefined) {
      found.set(id, element);
    }
  }
  return found;
}

function reorderDoc(keys: string[]): ReturnType<typeof mount> {
  return mount(
    docOf(
      keys.map((key, index) => ({ id: key, template: "item", title: "条目 " + String(index) })),
    ),
  );
}

function applyItems(
  runtime: ReturnType<typeof mountTreeDocument>,
  keys: string[],
  revision = 2,
): void {
  const result = runtime.applyOps({
    kind: "ops",
    document: revision,
    base: revision - 1,
    seq: 1,
    ops: [
      {
        op: "data",
        source: "ideas.feed",
        revision,
        items: keys.map((key, index) => ({
          id: key,
          template: "item",
          title: "条目 " + String(index),
        })),
      },
    ],
  });
  expect(result.ok).toBe(true);
}

describe("集合重排：批量提交 + 最小 DOM 移动", () => {
  it("末条置顶：新顺序正确，只 insertBefore 一次，元素全部复用", () => {
    const { container, runtime } = reorderDoc(["a", "b", "c", "d"]);
    const host = hostOf(container);
    const before = childElements(host);
    const spy = vi.spyOn(host, "insertBefore");

    applyItems(runtime, ["d", "a", "b", "c"]);

    expect(childIds(host)).toEqual([FEED + "#d", FEED + "#a", FEED + "#b", FEED + "#c"]);
    expect(spy).toHaveBeenCalledTimes(1);
    const after = childElements(host);
    for (const [id, element] of before) {
      expect(after.get(id)).toBe(element);
    }
    spy.mockRestore();
    runtime.dispose();
    container.remove();
  });

  it("头部插入：只挂 1 个新实例，已有元素一次都不移动", () => {
    const { container, runtime } = reorderDoc(["a", "b", "c"]);
    const host = hostOf(container);
    const before = childElements(host);
    const spy = vi.spyOn(host, "insertBefore");

    applyItems(runtime, ["x", "a", "b", "c"]);

    expect(childIds(host)).toEqual([FEED + "#x", FEED + "#a", FEED + "#b", FEED + "#c"]);
    const after = childElements(host);
    const inserted = after.get(FEED + "#x");
    expect(inserted).toBeDefined();
    const movedElements = spy.mock.calls.map((call) => call[0] as HTMLElement);
    expect(movedElements.length).toBeGreaterThan(0);
    expect(movedElements.every((element) => element === inserted)).toBe(true);
    for (const [id, element] of before) {
      expect(after.get(id)).toBe(element);
    }
    spy.mockRestore();
    runtime.dispose();
    container.remove();
  });

  it("删除一条：只卸 1 个实例，其余元素不移动", () => {
    const { container, runtime } = reorderDoc(["a", "b", "c"]);
    const host = hostOf(container);
    const before = childElements(host);
    const spy = vi.spyOn(host, "insertBefore");

    applyItems(runtime, ["a", "c"]);

    expect(childIds(host)).toEqual([FEED + "#a", FEED + "#c"]);
    expect(spy).not.toHaveBeenCalled();
    const after = childElements(host);
    expect(after.get(FEED + "#a")).toBe(before.get(FEED + "#a"));
    expect(after.get(FEED + "#c")).toBe(before.get(FEED + "#c"));
    expect(after.has(FEED + "#b")).toBe(false);
    spy.mockRestore();
    runtime.dispose();
    container.remove();
  });
});

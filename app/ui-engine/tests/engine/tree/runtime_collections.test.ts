// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { Document, Node } from "../../../src/contract/tree_generated";
import { TreeRuntime } from "../../../src/engine/tree/runtime";
import { fakeHarness, type FakeHarness } from "./test_fixtures";

/**
 * data op 的集合 reconcile 步长：一次只改一条时，运行时只该碰这一条的实例子树。
 * 断言落在渲染器 / 宿主这些注入边界上的调用（建、改、卸、重排），
 * 与集合规模无关：N=100 与 N=800 的触碰数必须一样。
 */

const ROOT = "aaaaaaaaaaaaaaaa";
const PAGE = "bbbbbbbbbbbbbbbb";
const FEED = "cccccccccccccccc";
const CARD = "dddddddddddddddd";
const TITLE = "eeeeeeeeeeeeeeee";
const TEXT_TEMPLATE = "ffffffffffffffff";
const SOURCE = "ideas.feed";
const CARD_KINDS = ["app", "column", "card", "text"] as const;
const TEXT_KINDS = ["app", "column", "text"] as const;

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

/** card 模板：标题与正文都绑到当前条目；正文是模板里的嵌套节点。 */
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

/** 一条只有一个节点的模板：插入 / 删除的宿主调用数好数。 */
function textTemplate(): Node {
  return node(TEXT_TEMPLATE, ROOT + "." + PAGE + "." + FEED + "." + TEXT_TEMPLATE, "text", 10, {
    settings: { text: "占位" },
    bind: { text: "item.title" },
  });
}

function feedNode(template: Node = cardTemplate()): Node {
  return node(FEED, ROOT + "." + PAGE + "." + FEED, "column", 10, {
    collection: {
      source: SOURCE,
      key: "id",
      select: "template",
      templates: { item: template },
    },
  });
}

function itemsOf(count: number, changedIndex = -1, changedTitle = "改"): Record<string, unknown>[] {
  return Array.from({ length: count }, (_value, index) => ({
    id: "k" + String(index),
    template: "item",
    title: index === changedIndex ? changedTitle : "条目 " + String(index),
  }));
}

function documentOf(items: Record<string, unknown>[], template: Node = cardTemplate()): Document {
  return {
    schema: "dendro.tree/1",
    version: 1,
    root: node(ROOT, ROOT, "app", 0, {
      layout: [
        node(PAGE, ROOT + "." + PAGE, "column", 10, {
          layout: [feedNode(template)],
        }),
      ],
    }),
    pages: [{ id: PAGE, title: "灵感", route: "/ideas" }],
    active: PAGE,
    data: { [SOURCE]: { revision: 1, items } },
  };
}

function batch(base: number, document: number, ops: unknown[]): Record<string, unknown> {
  return { kind: "ops", base, document, seq: 1, ops };
}

function dataOp(items: Record<string, unknown>[], revision = 2): Record<string, unknown> {
  return { op: "data", source: SOURCE, revision, items };
}

interface HostStep {
  readonly hostCalls: number;
  readonly reorderCalls: number;
  readonly rendererCalls: number;
  readonly diagnostics: string[];
}

function stepOf(harness: FakeHarness, runtime: TreeRuntime): HostStep {
  return {
    hostCalls: harness.hostCalls.length,
    reorderCalls: harness.reorderCalls.length,
    rendererCalls: harness.rendererCalls.length,
    diagnostics: runtime.diagnostics.map((diagnostic) => diagnostic.code),
  };
}

/** 挂 N 条 text 实例并清空调用记录，供重排步长测量。 */
function mountedText(count: number): { harness: FakeHarness; runtime: TreeRuntime } {
  const harness: FakeHarness = fakeHarness({ kinds: TEXT_KINDS });
  const runtime = new TreeRuntime({ host: harness.host, renderers: harness.renderers });
  expect(runtime.mount(documentOf(itemsOf(count), textTemplate())).ok).toBe(true);
  harness.resetCalls();
  return { harness, runtime };
}

/** 末条置顶：只提交一次重排。 */
function measurePin(count: number): HostStep {
  const { harness, runtime } = mountedText(count);
  const items = itemsOf(count);
  const last = items[count - 1];
  const reordered = last === undefined ? items : [last, ...items.slice(0, count - 1)];
  const result = runtime.applyOps(batch(1, 2, [dataOp(reordered)]));
  expect(result.ok).toBe(true);
  const step = stepOf(harness, runtime);
  runtime.dispose();
  return step;
}

/** 头部插入一个 key：只挂 1 个实例。 */
function measureHeadInsert(count: number): HostStep {
  const { harness, runtime } = mountedText(count);
  const inserted = [{ id: "fresh", template: "item", title: "新条目" }, ...itemsOf(count)];
  const result = runtime.applyOps(batch(1, 2, [dataOp(inserted)]));
  expect(result.ok).toBe(true);
  const step = stepOf(harness, runtime);
  runtime.dispose();
  return step;
}

/** 删中间一条：只卸 1 个实例。 */
function measureDelete(count: number): HostStep {
  const { harness, runtime } = mountedText(count);
  const middle = Math.floor(count / 2);
  const remaining = itemsOf(count).filter((_item, index) => index !== middle);
  const result = runtime.applyOps(batch(1, 2, [dataOp(remaining)]));
  expect(result.ok).toBe(true);
  const step = stepOf(harness, runtime);
  runtime.dispose();
  return step;
}

describe("data op → keyed collection reconcile 的步长", () => {
  it("只改一条：N=100 与 N=800 触碰的节点数相同，且只落在变化条目的实例上", () => {
    const harness: FakeHarness = fakeHarness({ kinds: CARD_KINDS });
    const runtime = new TreeRuntime({ host: harness.host, renderers: harness.renderers });
    expect(runtime.mount(documentOf(itemsOf(100))).ok).toBe(true);
    harness.resetCalls();

    const result = runtime.applyOps(batch(1, 2, [dataOp(itemsOf(100, 42, "条目 42 改"))]));
    expect(result.ok).toBe(true);

    const changed = FEED + "#k42";
    const expected = new Set([changed, changed + "/" + TITLE]);
    const touchedIds = harness.rendererCalls.map((call) => call.id);
    expect(new Set(touchedIds)).toEqual(expected);
    expect(harness.rendererCalls).toHaveLength(2);
    expect(harness.hostCalls).toEqual([]);
    expect(harness.reorderCalls).toEqual([]);
    expect(runtime.diagnostics).toEqual([]);
    runtime.dispose();
  });

  it("条目内容没变、只推进 revision：不碰任何渲染器与宿主", () => {
    const harness: FakeHarness = fakeHarness({ kinds: CARD_KINDS });
    const runtime = new TreeRuntime({ host: harness.host, renderers: harness.renderers });
    expect(runtime.mount(documentOf(itemsOf(100))).ok).toBe(true);
    harness.resetCalls();

    const result = runtime.applyOps(batch(1, 2, [dataOp(itemsOf(100))]));

    expect(result.ok).toBe(true);
    expect(harness.rendererCalls).toEqual([]);
    expect(harness.hostCalls).toEqual([]);
    expect(harness.reorderCalls).toEqual([]);
    expect(runtime.diagnostics).toEqual([]);
    runtime.dispose();
  });
});

describe("集合重排：批量提交 + 最小移动（宿主调用数不随集合规模增长）", () => {
  it("末条置顶：只提交一次重排，N=100 与 N=800 宿主调用数相同", () => {
    const small = measurePin(100);
    const large = measurePin(800);

    expect(small.reorderCalls).toBe(1);
    expect(small.hostCalls).toBe(0);
    expect(small.rendererCalls).toBe(0);
    expect(large.reorderCalls).toBe(small.reorderCalls);
    expect(large.hostCalls).toBe(small.hostCalls);
    expect(large.rendererCalls).toBe(small.rendererCalls);
    expect(small.diagnostics).toEqual([]);
    expect(large.diagnostics).toEqual([]);
  });

  it("头部插入：只挂 1 个实例，N=100 与 N=800 宿主调用数相同", () => {
    const small = measureHeadInsert(100);
    const large = measureHeadInsert(800);

    expect(small.rendererCalls).toBe(1);
    expect(small.hostCalls).toBe(1);
    expect(small.reorderCalls).toBeLessThanOrEqual(2);
    expect(large.rendererCalls).toBe(small.rendererCalls);
    expect(large.hostCalls).toBe(small.hostCalls);
    expect(large.reorderCalls).toBe(small.reorderCalls);
    expect(small.diagnostics).toEqual([]);
    expect(large.diagnostics).toEqual([]);
  });

  it("删除一条：只卸 1 个实例，N=100 与 N=800 宿主调用数相同", () => {
    const small = measureDelete(100);
    const large = measureDelete(800);

    expect(small.rendererCalls).toBe(1);
    expect(small.hostCalls).toBe(1);
    expect(small.reorderCalls).toBeLessThanOrEqual(1);
    expect(large.rendererCalls).toBe(small.rendererCalls);
    expect(large.hostCalls).toBe(small.hostCalls);
    expect(large.reorderCalls).toBe(small.reorderCalls);
    expect(small.diagnostics).toEqual([]);
    expect(large.diagnostics).toEqual([]);
  });
});

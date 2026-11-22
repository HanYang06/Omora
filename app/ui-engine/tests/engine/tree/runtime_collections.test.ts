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
const SOURCE = "ideas.feed";
const KINDS = ["app", "column", "card", "text"] as const;

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

function feedNode(): Node {
  return node(FEED, ROOT + "." + PAGE + "." + FEED, "column", 10, {
    collection: {
      source: SOURCE,
      key: "id",
      select: "template",
      templates: { item: cardTemplate() },
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

function documentOf(items: Record<string, unknown>[]): Document {
  return {
    schema: "dendro.tree/1",
    version: 1,
    root: node(ROOT, ROOT, "app", 0, {
      layout: [
        node(PAGE, ROOT + "." + PAGE, "column", 10, {
          layout: [feedNode()],
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

interface Step {
  readonly touched: number;
  readonly touchedIds: string[];
  readonly diagnostics: string[];
}

/** 挂 N 条，只改 changedIndex 一条，返回渲染器 / 宿主被调用过的节点。 */
function measureStep(count: number, changedIndex: number): Step {
  const harness: FakeHarness = fakeHarness({ kinds: KINDS });
  const runtime = new TreeRuntime({ host: harness.host, renderers: harness.renderers });
  const mounted = runtime.mount(documentOf(itemsOf(count)));
  expect(mounted.ok).toBe(true);
  harness.resetCalls();

  const result = runtime.applyOps(
    batch(1, 2, [
      {
        op: "data",
        source: SOURCE,
        revision: 2,
        items: itemsOf(count, changedIndex, "条目 " + String(changedIndex) + " 改"),
      },
    ]),
  );
  expect(result.ok).toBe(true);

  const calls = [...harness.rendererCalls, ...harness.hostCalls];
  const step: Step = {
    touched: calls.length,
    touchedIds: calls.map((call) => call.id),
    diagnostics: runtime.diagnostics.map((diagnostic) => diagnostic.code),
  };
  runtime.dispose();
  return step;
}

describe("data op → keyed collection reconcile 的步长", () => {
  it("只改一条：N=100 与 N=800 触碰的节点数相同，且只落在变化条目的实例上", () => {
    const small = measureStep(100, 42);
    const large = measureStep(800, 42);

    const changed = FEED + "#k42";
    const expected = new Set([changed, changed + "/" + TITLE]);
    expect(new Set(small.touchedIds)).toEqual(expected);
    expect(new Set(large.touchedIds)).toEqual(expected);
    expect(small.touched).toBe(large.touched);
    expect(small.touched).toBeLessThanOrEqual(8);
    expect(small.diagnostics).toEqual([]);
    expect(large.diagnostics).toEqual([]);
  });

  it("条目内容没变、只推进 revision：不碰任何渲染器与宿主", () => {
    const harness: FakeHarness = fakeHarness({ kinds: KINDS });
    const runtime = new TreeRuntime({ host: harness.host, renderers: harness.renderers });
    expect(runtime.mount(documentOf(itemsOf(100))).ok).toBe(true);
    harness.resetCalls();

    const result = runtime.applyOps(
      batch(1, 2, [{ op: "data", source: SOURCE, revision: 2, items: itemsOf(100) }]),
    );

    expect(result.ok).toBe(true);
    expect(harness.rendererCalls).toEqual([]);
    expect(harness.hostCalls).toEqual([]);
    expect(runtime.diagnostics).toEqual([]);
    runtime.dispose();
  });
});

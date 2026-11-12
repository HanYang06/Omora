import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { SlotNode } from "../core/document";
import type { DataState } from "./data";
import { applyData, parseData, type ApplyDataResult } from "./data";
import { DocumentIndex } from "./document";
import { node, stateOf } from "./test_fixtures";

/**
 * 共享 fixture（不许改）：三条负载依次是标量 value、集合 items 全量、集合 changes 增量。
 * 集合负载都指向 ideas.feed，标量指向 session.status。
 */
const DATA_FIXTURE_PATH = fileURLToPath(
  new URL("../../../sdk/tests/fixtures/data.json", import.meta.url),
);

function fixturePayloads(): unknown[] {
  const value: unknown = JSON.parse(readFileSync(DATA_FIXTURE_PATH, "utf8"));
  if (!Array.isArray(value)) {
    throw new Error("共享 data fixture 应该是数组");
  }
  return value;
}

function template(over: Partial<SlotNode> = {}): SlotNode {
  return node({
    id: "tpl.item",
    kind: "ideas:card",
    owner: "ideas",
    props: { variant: "card" },
    bind: { title: "item.title" },
    ...over,
  });
}

/** 集合 slot：source = ideas.feed，模板 item 把 item.title 绑进 props.title。 */
function feed(over: Partial<SlotNode> = {}): SlotNode {
  return node({
    id: "ideas.feed",
    owner: "ideas",
    layout: { flow: "column", capacity: "many" },
    collection: {
      source: "ideas.feed",
      key: "id",
      select: "template",
      templates: { item: template() },
    },
    ...over,
  });
}

/** base 文档：root + 集合 slot ideas.feed + 两个不该被动到的兄弟节点，版本 3。 */
function baseRoot(): SlotNode {
  return node({
    id: "dendro.window",
    kind: "dendro:window",
    owner: "ideas",
    layout: { flow: "column", capacity: "many" },
    children: [
      node({ id: "ideas.header", owner: "ideas", layout: { flow: "row", capacity: "one" } }),
      feed(),
      node({ id: "ideas.search", kind: "dendro:search", owner: "ideas", props: { value: "" } }),
    ],
  });
}

function baseState() {
  return stateOf(baseRoot(), 3);
}

function slotChildren(root: SlotNode, slotId: string): SlotNode[] {
  const slot = DocumentIndex.build(root).get(slotId);
  if (slot === undefined) {
    throw new Error("找不到 slot: " + slotId);
  }
  return slot.children;
}

function idsOf(root: SlotNode, slotId: string): string[] {
  return slotChildren(root, slotId).map((child) => child.id);
}

function titlesOf(root: SlotNode, slotId: string): unknown[] {
  return slotChildren(root, slotId).map((child) => child.props.title);
}

function expectApplied(result: ApplyDataResult) {
  if (!result.ok) {
    throw new Error("数据应应用成功: " + JSON.stringify(result.diagnostics));
  }
  return result;
}

function expectFailed(result: ApplyDataResult) {
  if (result.ok) {
    throw new Error("数据应被拒绝");
  }
  return result.diagnostics;
}

function payloadOf(over: Record<string, unknown>): unknown {
  return { kind: "data", owner: "ideas", source: "ideas.feed", revision: 1, ...over };
}

describe("parseData：数据信封", () => {
  it("共享 fixture 归一化成标量 / 全量集合 / 增量集合", () => {
    const parsed = fixturePayloads().map(parseData);
    for (const result of parsed) {
      if (!result.ok) {
        throw new Error("共享 fixture 应能解析: " + JSON.stringify(result.diagnostics));
      }
    }
    const [scalar, items, changes] = parsed;
    if (scalar === undefined || items === undefined || changes === undefined) {
      throw new Error("fixture 应有三条负载");
    }
    if (!scalar.ok || !items.ok || !changes.ok) {
      return;
    }
    expect(scalar.payload).toEqual({
      kind: "data",
      owner: "net",
      source: "session.status",
      revision: 1,
      value: { connected: true },
    });
    if (!("items" in items.payload)) {
      throw new Error("第二条应是 items 全量");
    }
    expect(items.payload.items.map((item) => item.id)).toEqual(["42", "7"]);
    expect(items.payload.revision).toBe(5);
    if (!("changes" in changes.payload)) {
      throw new Error("第三条应是 changes 增量");
    }
    expect(changes.payload.changes.map((change) => change.kind)).toEqual([
      "insert",
      "update",
      "remove",
      "move",
    ]);
  });

  it("信封不合法一律 E-PAYLOAD，不抛", () => {
    const bad: unknown[] = [
      null,
      "data",
      { kind: "ops", owner: "ideas", source: "s", revision: 1, value: 1 },
      { kind: "data", owner: "", source: "s", revision: 1, value: 1 },
      { kind: "data", owner: "ideas", source: "  ", revision: 1, value: 1 },
      { kind: "data", owner: "ideas", source: "s", revision: -1, value: 1 },
      { kind: "data", owner: "ideas", source: "s", revision: 1.5, value: 1 },
      { kind: "data", owner: "ideas", source: "s", revision: "1", value: 1 },
      { kind: "data", owner: "ideas", source: "s", revision: 1 },
      { kind: "data", owner: "ideas", source: "s", revision: 1, value: 1, items: [] },
      { kind: "data", owner: "ideas", source: "s", revision: 1, items: "x" },
      { kind: "data", owner: "ideas", source: "s", revision: 1, changes: {} },
      { kind: "data", owner: "ideas", source: "s", revision: 1, value: () => 1 },
    ];

    for (const payload of bad) {
      const result = parseData(payload);
      expect(result.ok).toBe(false);
      if (result.ok) {
        continue;
      }
      expect(result.diagnostics[0]?.code).toBe("E-PAYLOAD");
      expect(result.diagnostics[0]?.severity).toBe("error");
    }
  });

  it("revision 0、null 值与空 items 都是合法负载", () => {
    for (const payload of [
      { kind: "data", owner: "ideas", source: "s", revision: 0, value: null },
      { kind: "data", owner: "ideas", source: "s", revision: 0, items: [] },
      { kind: "data", owner: "ideas", source: "s", revision: 0, changes: [] },
    ]) {
      expect(parseData(payload).ok).toBe(true);
    }
  });

  it("解析结果与入参解耦：之后改原条目不影响已归一化的 items", () => {
    const raw: { id: string; template: string; title?: string }[] = [{ id: "a", template: "item" }];
    const parsed = parseData({
      kind: "data",
      owner: "ideas",
      source: "ideas.feed",
      revision: 2,
      items: raw,
    });

    const first = raw[0];
    if (first !== undefined) {
      first.title = "改名";
    }
    raw.push({ id: "b", template: "item" });

    if (!parsed.ok || !("items" in parsed.payload)) {
      throw new Error("items 负载应能解析");
    }
    expect(parsed.payload.items.map((item) => item.id)).toEqual(["a"]);
    expect(parsed.payload.items[0]?.title).toBeUndefined();
  });
});

describe("applyData：标量数据", () => {
  it("只写数据文档：value / revision 更新，文档版本与根树不变，changed 空", () => {
    const document = baseState();
    const result = expectApplied(applyData(document, {}, fixturePayloads()[0]));

    expect(result.document).toBe(document);
    expect(result.document.version).toBe(3);
    expect(result.data["session.status"]).toEqual({ revision: 1, value: { connected: true } });
    expect(result.changed).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("标量到 props 的绑定本任务不做：source 被集合消费时也不动树", () => {
    const document = baseState();
    const result = expectApplied(
      applyData(document, {}, payloadOf({ revision: 2, value: { title: "不该进 props" } })),
    );

    expect(result.document).toBe(document);
    expect(idsOf(result.document.root, "ideas.feed")).toEqual([]);
    expect(result.data["ideas.feed"]?.value).toEqual({ title: "不该进 props" });
    expect(result.changed).toEqual([]);
  });
});

describe("applyData：集合 items 全量", () => {
  it("整槽实例化：条目 id 按 key 派生、bind 进 props、模板表与位置保留", () => {
    const document = baseState();
    const header = document.root.children[0];
    const result = expectApplied(applyData(document, {}, fixturePayloads()[1]));

    expect(result.document.version).toBe(3);
    const root = result.document.root;
    expect(root.children.map((child) => child.id)).toEqual([
      "ideas.header",
      "ideas.feed",
      "ideas.search",
    ]);
    expect(root.children[0]).toBe(header);
    expect(idsOf(root, "ideas.feed")).toEqual(["ideas.feed#42", "ideas.feed#7"]);
    expect(titlesOf(root, "ideas.feed")).toEqual(["买牛奶", "录音"]);
    expect(DocumentIndex.build(root).get("ideas.feed")?.collection?.templates.item?.id).toBe(
      "tpl.item",
    );
    expect(result.changed).toEqual(["ideas.feed"]);
    expect(result.data["ideas.feed"]?.revision).toBe(5);
    expect(result.data["ideas.feed"]?.items?.map((item) => item.id)).toEqual(["42", "7"]);
    expect(result.diagnostics).toEqual([]);
  });

  it("不改入参：原文档仍没有条目、原数据 map 照旧", () => {
    const document = baseState();
    const data: DataState = { "session.status": { revision: 1, value: { connected: true } } };
    const documentSnapshot = structuredClone(document);
    const dataSnapshot = structuredClone(data);

    expectApplied(applyData(document, data, fixturePayloads()[1]));

    expect(document).toEqual(documentSnapshot);
    expect(data).toEqual(dataSnapshot);
  });

  it("无 slot 消费的 source：只写数据文档，changed 空、根树引用不变", () => {
    const document = baseState();
    const payload = payloadOf({
      source: "ideas.progress",
      revision: 3,
      items: [{ id: "x", template: "item" }],
    });
    const result = expectApplied(applyData(document, {}, payload));

    expect(result.document).toBe(document);
    expect(result.data["ideas.progress"]?.items?.map((item) => item.id)).toEqual(["x"]);
    expect(result.changed).toEqual([]);
  });
});

describe("applyData：集合 changes 增量", () => {
  it("依次应用共享 fixture：42 标题更新、7 消失、43 排到 42 后面", () => {
    const [scalar, items, changes] = fixturePayloads();
    const first = expectApplied(applyData(baseState(), {}, scalar));
    const second = expectApplied(applyData(first.document, first.data, items));
    const third = expectApplied(applyData(second.document, second.data, changes));

    expect(third.document.version).toBe(3);
    expect(idsOf(third.document.root, "ideas.feed")).toEqual(["ideas.feed#42", "ideas.feed#43"]);
    expect(titlesOf(third.document.root, "ideas.feed")).toEqual(["买牛奶（改）", "新条目"]);
    expect(third.changed).toEqual(["ideas.feed"]);
    expect(third.diagnostics).toEqual([]);
    expect(third.data["ideas.feed"]?.revision).toBe(6);
    expect(third.data["ideas.feed"]?.items?.map((item) => item.id)).toEqual(["42", "43"]);
    expect(third.data["session.status"]).toEqual({ revision: 1, value: { connected: true } });
  });

  it("没有历史 items 时按空列表应用：落不上的 change 记 E-PAYLOAD 并跳过", () => {
    const changes = fixturePayloads()[2];
    const result = expectApplied(applyData(baseState(), {}, changes));

    expect(idsOf(result.document.root, "ideas.feed")).toEqual(["ideas.feed#43"]);
    expect(result.data["ideas.feed"]?.revision).toBe(6);
    expect(result.data["ideas.feed"]?.items?.map((item) => item.id)).toEqual(["43"]);
    expect(result.changed).toEqual(["ideas.feed"]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "E-PAYLOAD",
      "E-PAYLOAD",
    ]);
  });
});

describe("applyData：revision 幂等", () => {
  it("同 revision 重复到达是 no-op：文档与数据引用都不变", () => {
    const items = fixturePayloads()[1];
    const first = expectApplied(applyData(baseState(), {}, items));
    const again = expectApplied(applyData(first.document, first.data, items));

    expect(again.document).toBe(first.document);
    expect(again.data).toBe(first.data);
    expect(again.changed).toEqual([]);
    expect(again.diagnostics).toEqual([]);
  });

  it("旧 revision 迟到：即使内容不同也不回退", () => {
    const items = fixturePayloads()[1];
    const first = expectApplied(applyData(baseState(), {}, items));
    const stale = payloadOf({
      revision: 4,
      items: [{ id: "9", template: "item", title: "旧数据" }],
    });
    const late = expectApplied(applyData(first.document, first.data, stale));

    expect(late.document).toBe(first.document);
    expect(late.data).toBe(first.data);
    expect(idsOf(late.document.root, "ideas.feed")).toEqual(["ideas.feed#42", "ideas.feed#7"]);
  });

  it("同 revision 换了内容也 no-op：幂等按 revision 判断", () => {
    const items = fixturePayloads()[1];
    const first = expectApplied(applyData(baseState(), {}, items));
    const sameRevision = payloadOf({ revision: 5, items: [{ id: "9", template: "item" }] });
    const ignored = expectApplied(applyData(first.document, first.data, sameRevision));

    expect(ignored.document).toBe(first.document);
    expect(idsOf(ignored.document.root, "ideas.feed")).toEqual(["ideas.feed#42", "ideas.feed#7"]);
  });
});

describe("applyData：多个集合 slot 消费同一 source", () => {
  function twoFeedsRoot(): SlotNode {
    return node({
      id: "dendro.window",
      kind: "dendro:window",
      owner: "ideas",
      children: [
        feed(),
        node({
          id: "ideas.rail",
          owner: "ideas",
          layout: { flow: "column", capacity: "many" },
          collection: {
            source: "ideas.feed",
            key: "id",
            select: "template",
            templates: { item: template({ id: "tpl.rail", kind: "ideas:pinned" }) },
          },
        }),
      ],
    });
  }

  it("每个消费者都实例化，changed 按替换顺序去重列出集合 slot id", () => {
    const result = expectApplied(applyData(stateOf(twoFeedsRoot(), 3), {}, fixturePayloads()[1]));

    expect(result.changed).toEqual(["ideas.feed", "ideas.rail"]);
    expect(idsOf(result.document.root, "ideas.feed")).toEqual(["ideas.feed#42", "ideas.feed#7"]);
    expect(idsOf(result.document.root, "ideas.rail")).toEqual(["ideas.rail#42", "ideas.rail#7"]);
    expect(DocumentIndex.build(result.document.root).get("ideas.rail#42")?.kind).toBe(
      "ideas:pinned",
    );
  });

  it("增量按同一份条目重建每个消费者，各自模板生效", () => {
    const items = fixturePayloads()[1];
    const changes = fixturePayloads()[2];
    const first = expectApplied(applyData(stateOf(twoFeedsRoot(), 3), {}, items));
    const second = expectApplied(applyData(first.document, first.data, changes));

    expect(second.changed).toEqual(["ideas.feed", "ideas.rail"]);
    expect(idsOf(second.document.root, "ideas.rail")).toEqual(["ideas.rail#42", "ideas.rail#43"]);
    expect(titlesOf(second.document.root, "ideas.rail")).toEqual(["买牛奶（改）", "新条目"]);
  });

  it("in[] 消费同一 source 的普通节点不算集合消费者，不进 changed", () => {
    const root = node({
      id: "dendro.window",
      kind: "dendro:window",
      owner: "ideas",
      children: [
        node({ id: "ideas.status", owner: "ideas", in: [{ source: "ideas.feed" }] }),
        feed(),
      ],
    });
    const result = expectApplied(applyData(stateOf(root, 3), {}, fixturePayloads()[1]));

    expect(result.changed).toEqual(["ideas.feed"]);
    expect(idsOf(result.document.root, "ideas.feed")).toEqual(["ideas.feed#42", "ideas.feed#7"]);
  });
});

describe("applyData：坏条目、原子性与索引", () => {
  it("未知模板的条目只丢自己并记 E-TEMPLATE，其余照常实例化", () => {
    const payload = payloadOf({
      revision: 1,
      items: [
        { id: "42", template: "item", title: "买牛奶" },
        { id: "ghost", template: "ghost", title: "坏条目" },
        { id: "7", template: "item", title: "录音" },
      ],
    });
    const result = expectApplied(applyData(baseState(), {}, payload));

    expect(idsOf(result.document.root, "ideas.feed")).toEqual(["ideas.feed#42", "ideas.feed#7"]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["E-TEMPLATE"]);
    expect(result.diagnostics[0]?.slot).toBe("ideas.feed");
    expect(result.changed).toEqual(["ideas.feed"]);
    expect(result.data["ideas.feed"]?.revision).toBe(1);
  });

  it("信封非法：ok:false，文档与数据都保持原样", () => {
    const document = baseState();
    const data: DataState = {
      "ideas.feed": { revision: 5, items: [{ id: "a", template: "item" }] },
    };
    const documentSnapshot = structuredClone(document);
    const dataSnapshot = structuredClone(data);

    const diagnostics = expectFailed(
      applyData(document, data, {
        kind: "data",
        owner: "ideas",
        source: "ideas.feed",
        revision: 6,
      }),
    );

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["E-PAYLOAD"]);
    expect(document).toEqual(documentSnapshot);
    expect(data).toEqual(dataSnapshot);
  });

  it("替换后索引与树一致：新条目可定位、消失的条目查不到", () => {
    const items = fixturePayloads()[1];
    const changes = fixturePayloads()[2];
    const first = expectApplied(applyData(baseState(), {}, items));
    const second = expectApplied(applyData(first.document, first.data, changes));

    const index = DocumentIndex.build(second.document.root);
    expect(index.get("ideas.feed#7")).toBeUndefined();
    expect(index.get("ideas.feed#43")?.props.title).toBe("新条目");
    expect(index.parentOf("ideas.feed#42")).toEqual({ parentId: "ideas.feed", order: 0 });
    expect(index.parentOf("ideas.feed#43")).toEqual({ parentId: "ideas.feed", order: 1 });
    expect(index.slotsFor("ideas.feed")).toEqual(["ideas.feed"]);
    expect(index.get("tpl.item")?.id).toBe("tpl.item");
  });
});

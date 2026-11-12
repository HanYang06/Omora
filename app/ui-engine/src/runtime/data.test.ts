import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { SlotNode } from "../core/document";
import type { DataState } from "./data";
import { applyData, parseData, type ApplyDataResult } from "./data";
import { DocumentIndex, type DocumentState } from "./document";
import { node, stateOf } from "./test_fixtures";

/** 共享 fixture（不许改）：三条负载依次是标量 value、集合 items 全量、集合 changes 增量。 */
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
function baseState(): DocumentState {
  return stateOf(
    node({
      id: "dendro.window",
      kind: "dendro:window",
      owner: "ideas",
      layout: { flow: "column", capacity: "many" },
      children: [
        node({ id: "ideas.header", owner: "ideas", layout: { flow: "row", capacity: "one" } }),
        feed(),
        node({ id: "ideas.search", kind: "dendro:search", owner: "ideas", props: { value: "" } }),
      ],
    }),
    3,
  );
}

function slotOf(document: DocumentState, slotId: string): SlotNode | undefined {
  return DocumentIndex.build(document.root).get(slotId);
}

function childrenOf(root: SlotNode, slotId: string): SlotNode[] {
  const slot = DocumentIndex.build(root).get(slotId);
  if (slot === undefined) {
    throw new Error("找不到 slot: " + slotId);
  }
  return slot.children;
}

function idsOf(root: SlotNode, slotId: string): string[] {
  return childrenOf(root, slotId).map((child) => child.id);
}

/** 一个 slot 的子节点 id / 标题（标题可选，绑进 props.title 的集合才有）。 */
function expectSlot(root: SlotNode, slotId: string, ids: string[], titles?: unknown[]): void {
  expect(idsOf(root, slotId)).toEqual(ids);
  if (titles !== undefined) {
    expect(childrenOf(root, slotId).map((child) => child.props.title)).toEqual(titles);
  }
}

function expectApplied(result: ApplyDataResult) {
  if (!result.ok) {
    throw new Error("数据应应用成功: " + JSON.stringify(result.diagnostics));
  }
  return result;
}

function expectParsed(payload: unknown) {
  const result = parseData(payload);
  if (!result.ok) {
    throw new Error("payload 应能解析: " + JSON.stringify(result.diagnostics));
  }
  return result.payload;
}

function payloadOf(over: Record<string, unknown>): unknown {
  return { kind: "data", owner: "ideas", source: "ideas.feed", revision: 1, ...over };
}

/** 声明 in（默认消费 session.status）的消费者节点。 */
function consumer(id: string, over: Partial<SlotNode> = {}): SlotNode {
  return node({ id, owner: "ideas", in: [{ source: "session.status" }], ...over });
}

/** window 根，children 就是消费者。 */
function bindRoot(...children: SlotNode[]): SlotNode {
  return node({ id: "dendro.window", kind: "dendro:window", owner: "ideas", children });
}

/** 指向 session.status 的标量负载。 */
function statusPayload(over: Record<string, unknown>): unknown {
  return payloadOf({ source: "session.status", revision: 1, ...over });
}

describe("parseData：数据信封", () => {
  it("共享 fixture 归一化；revision 0、null 值、空 items/changes 也合法", () => {
    const scalar = expectParsed(fixturePayloads()[0]);
    const items = expectParsed(fixturePayloads()[1]);
    const changes = expectParsed(fixturePayloads()[2]);
    expect(scalar).toEqual({
      kind: "data",
      owner: "net",
      source: "session.status",
      revision: 1,
      value: { connected: true },
    });
    if (!("items" in items)) {
      throw new Error("第二条应是 items 全量");
    }
    expect(items.items.map((item) => item.id)).toEqual(["42", "7"]);
    expect(items.revision).toBe(5);
    if (!("changes" in changes)) {
      throw new Error("第三条应是 changes 增量");
    }
    expect(changes.changes.map((change) => change.kind)).toEqual([
      "insert",
      "update",
      "remove",
      "move",
    ]);
    for (const legal of [
      { kind: "data", owner: "ideas", source: "s", revision: 0, value: null },
      { kind: "data", owner: "ideas", source: "s", revision: 0, items: [] },
      { kind: "data", owner: "ideas", source: "s", revision: 0, changes: [] },
    ]) {
      expect(parseData(legal).ok).toBe(true);
    }
  });

  it("信封不合法一律 E-PAYLOAD，不抛；解析结果与入参解耦", () => {
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
      if (!result.ok) {
        expect(result.diagnostics[0]?.code).toBe("E-PAYLOAD");
        expect(result.diagnostics[0]?.severity).toBe("error");
      }
    }

    const raw: { id: string; template: string; title?: string }[] = [{ id: "a", template: "item" }];
    const parsed = expectParsed({
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

    if (!("items" in parsed)) {
      throw new Error("items 负载应能解析");
    }
    expect(parsed.items.map((item) => item.id)).toEqual(["a"]);
    expect(parsed.items[0]?.title).toBeUndefined();
  });
});

describe("applyData：标量绑定 in/bind → props", () => {
  it("单 input：bind 从 value 根解析（嵌套、null），in[].path 只作订阅提示", () => {
    const root = bindRoot(
      consumer("ideas.status", {
        in: [{ source: "session.status", path: "net" }],
        props: { connected: "旧", chunk: { online: true } },
        bind: { connected: "connected", online: "net.online", chunk: "net" },
      }),
    );
    const document = stateOf(root, 3);
    const chunk = document.root.children[0]?.props.chunk;
    const payload = statusPayload({ value: { connected: null, net: { online: true } } });
    const result = expectApplied(applyData(document, {}, payload));
    const props = slotOf(result.document, "ideas.status")?.props;

    expect(props).toEqual({ connected: null, online: true, chunk: { online: true } });
    expect(props?.chunk).toBe(chunk);
    expect(result.changed).toEqual(["ideas.status"]);
  });

  it("多 input：写 source 前缀的解析；无前缀跳过、解析不到、指针等于 source 都保留原值", () => {
    const root = bindRoot(
      consumer("ideas.status", {
        in: [{ source: "session.status" }, { source: "session.user" }],
        props: { name: "旧名", missing: 1, whole: 3, deep: 2 },
        bind: {
          connected: "session.status.connected",
          name: "name",
          missing: "session.status.nope",
          whole: "session.status",
          deep: "session.status.connected.deep",
        },
      }),
    );
    const result = expectApplied(
      applyData(stateOf(root, 3), {}, statusPayload({ value: { connected: true } })),
    );
    const props = slotOf(result.document, "ideas.status")?.props;

    expect(props).toEqual({ name: "旧名", missing: 1, whole: 3, deep: 2, connected: true });
    expect(result.changed).toEqual(["ideas.status"]);
    expect(result.diagnostics).toEqual([]);
  });

  it("同 source 多消费者：改了的按文档序进 changed；集合 slot 自身 in 也算消费者", () => {
    const root = bindRoot(
      consumer("ideas.conn", { props: { connected: true }, bind: { connected: "connected" } }),
      consumer("ideas.label", { bind: { label: "label" } }),
      consumer("ideas.count", { bind: { count: "count" } }),
      consumer("ideas.idle"),
      feed({ in: [{ source: "ideas.feed" }], bind: { total: "total" } }),
      feed({
        id: "ideas.rail",
        collection: {
          source: "ideas.feed",
          key: "id",
          select: "template",
          templates: { item: template({ id: "tpl.rail", kind: "ideas:pinned" }) },
        },
      }),
    );
    const document = stateOf(root, 3);
    const untouched = document.root.children[0];
    const statusValue = { connected: true, label: "已连接", count: 3 };
    const status = expectApplied(applyData(document, {}, statusPayload({ value: statusValue })));
    const feedPayload = payloadOf({ source: "ideas.feed", revision: 2, value: { total: 3 } });
    const bound = expectApplied(applyData(status.document, status.data, feedPayload));

    expect(status.changed).toEqual(["ideas.label", "ideas.count"]);
    expect(status.document.root.children[0]).toBe(untouched);
    expect(bound.changed).toEqual(["ideas.feed"]);
    expect(bound.document.root.children[4]?.props).toEqual({ total: 3 });
  });

  it("revision 幂等：重复与更旧的标量负载都不重放绑定；无消费者只写数据", () => {
    const root = bindRoot(consumer("ideas.status", { bind: { connected: "connected" } }));
    const first = expectApplied(
      applyData(stateOf(root, 3), {}, statusPayload({ value: { connected: true } })),
    );
    const again = expectApplied(
      applyData(first.document, first.data, statusPayload({ value: { connected: true } })),
    );
    const stalePayload = statusPayload({ revision: 0, value: { connected: false } });
    const stale = expectApplied(applyData(first.document, first.data, stalePayload));
    const idle = baseState();
    const noConsumer = expectApplied(
      applyData(idle, {}, statusPayload({ value: { connected: true } })),
    );

    expect(again.document).toBe(first.document);
    expect(again.data).toBe(first.data);
    expect(again.changed).toEqual([]);
    expect(stale.document).toBe(first.document);
    expect(slotOf(stale.document, "ideas.status")?.props.connected).toBe(true);
    expect(noConsumer.document).toBe(idle);
    expect(noConsumer.data["session.status"]).toEqual({ revision: 1, value: { connected: true } });
  });
});

describe("applyData：集合 items 全量", () => {
  it("整槽实例化：条目 id 按 key 派生、bind 进 props、模板表与位置保留", () => {
    const document = baseState();
    const header = document.root.children[0];
    const result = expectApplied(applyData(document, {}, fixturePayloads()[1]));
    const root = result.document.root;

    expect(root.children.map((child) => child.id)).toEqual([
      "ideas.header",
      "ideas.feed",
      "ideas.search",
    ]);
    expect(root.children[0]).toBe(header);
    expectSlot(root, "ideas.feed", ["ideas.feed#42", "ideas.feed#7"], ["买牛奶", "录音"]);
    expect(DocumentIndex.build(root).get("ideas.feed")?.collection?.templates.item?.id).toBe(
      "tpl.item",
    );
    expect(result.changed).toEqual(["ideas.feed"]);
    expect(result.data["ideas.feed"]?.revision).toBe(5);
    expect(result.data["ideas.feed"]?.items?.map((item) => item.id)).toEqual(["42", "7"]);
  });

  it("无 slot 消费的 source：只写数据文档，changed 空、根树引用不变", () => {
    const document = baseState();
    const progress = payloadOf({
      source: "ideas.progress",
      revision: 3,
      items: [{ id: "x", template: "item" }],
    });
    const result = expectApplied(applyData(document, {}, progress));

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
    expectSlot(
      third.document.root,
      "ideas.feed",
      ["ideas.feed#42", "ideas.feed#43"],
      ["买牛奶（改）", "新条目"],
    );
    expect(third.changed).toEqual(["ideas.feed"]);
    expect(third.data["ideas.feed"]?.revision).toBe(6);
    expect(third.data["ideas.feed"]?.items?.map((item) => item.id)).toEqual(["42", "43"]);
    expect(third.data["session.status"]).toEqual({ revision: 1, value: { connected: true } });
  });

  it("没有历史 items 时按空列表应用：落不上的 change 记 E-PAYLOAD 并跳过", () => {
    const result = expectApplied(applyData(baseState(), {}, fixturePayloads()[2]));

    expectSlot(result.document.root, "ideas.feed", ["ideas.feed#43"]);
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
  it("同 revision（含换了内容）与更旧的迟到负载都是 no-op：文档与数据引用不变", () => {
    const items = fixturePayloads()[1];
    const first = expectApplied(applyData(baseState(), {}, items));
    const again = expectApplied(applyData(first.document, first.data, items));
    const samePayload = payloadOf({ revision: 5, items: [{ id: "9", template: "item" }] });
    const latePayload = payloadOf({ revision: 4, items: [{ id: "9", template: "item" }] });
    const sameRevision = expectApplied(applyData(first.document, first.data, samePayload));
    const late = expectApplied(applyData(first.document, first.data, latePayload));

    expect(again.document).toBe(first.document);
    expect(again.data).toBe(first.data);
    expect(again.changed).toEqual([]);
    expect(again.diagnostics).toEqual([]);
    expect(sameRevision.document).toBe(first.document);
    expect(late.document).toBe(first.document);
    expect(late.data).toBe(first.data);
    expectSlot(late.document.root, "ideas.feed", ["ideas.feed#42", "ideas.feed#7"]);
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
        feed({
          id: "ideas.rail",
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

  it("items 与 changes 都让每个消费者按自己的模板实例化，changed 去重列出", () => {
    const items = fixturePayloads()[1];
    const changes = fixturePayloads()[2];
    const first = expectApplied(applyData(stateOf(twoFeedsRoot(), 3), {}, items));
    const second = expectApplied(applyData(first.document, first.data, changes));

    expect(first.changed).toEqual(["ideas.feed", "ideas.rail"]);
    expect(idsOf(first.document.root, "ideas.rail")).toEqual(["ideas.rail#42", "ideas.rail#7"]);
    expect(DocumentIndex.build(first.document.root).get("ideas.rail#42")?.kind).toBe(
      "ideas:pinned",
    );
    expect(second.changed).toEqual(["ideas.feed", "ideas.rail"]);
    expectSlot(
      second.document.root,
      "ideas.rail",
      ["ideas.rail#42", "ideas.rail#43"],
      ["买牛奶（改）", "新条目"],
    );
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
    expectSlot(result.document.root, "ideas.feed", ["ideas.feed#42", "ideas.feed#7"]);
  });
});

describe("applyData：坏条目、原子性与索引", () => {
  it("未知模板的条目只丢自己并记 E-TEMPLATE，其余照常；替换后索引与树一致", () => {
    const payload = payloadOf({
      revision: 1,
      items: [
        { id: "42", template: "item", title: "买牛奶" },
        { id: "ghost", template: "ghost", title: "坏条目" },
        { id: "7", template: "item", title: "录音" },
      ],
    });
    const result = expectApplied(applyData(baseState(), {}, payload));
    const root = result.document.root;

    expectSlot(root, "ideas.feed", ["ideas.feed#42", "ideas.feed#7"], ["买牛奶", "录音"]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["E-TEMPLATE"]);
    expect(result.changed).toEqual(["ideas.feed"]);
  });

  it("信封非法原子失败；合法应用也不改写入参", () => {
    const document = stateOf(
      bindRoot(consumer("ideas.status", { bind: { connected: "connected" } })),
      3,
    );
    const data: DataState = { "session.status": { revision: 0, value: { connected: false } } };
    const documentSnapshot = structuredClone(document);
    const dataSnapshot = structuredClone(data);

    const rejected = applyData(document, data, {
      kind: "data",
      owner: "ideas",
      source: "ideas.feed",
      revision: 6,
    });
    if (rejected.ok) {
      throw new Error("数据应被拒绝");
    }
    expect(rejected.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["E-PAYLOAD"]);
    expectApplied(applyData(document, data, statusPayload({ value: { connected: true } })));
    expectApplied(applyData(document, data, fixturePayloads()[1]));

    expect(document).toEqual(documentSnapshot);
    expect(data).toEqual(dataSnapshot);
  });
});

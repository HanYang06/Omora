import { describe, expect, it } from "vitest";
import {
  DOCUMENT_SCHEMA,
  parseDocument,
  type Collection,
  type SlotNode,
} from "../../contract/document";
import {
  applyCollectionChanges,
  instantiateCollection,
  resolveBindPath,
  type CollectionChange,
  type CollectionItem,
  type CollectionResult,
} from "./collection";

function slot(over: Partial<SlotNode> & { id: string }): SlotNode {
  return { kind: "dendro:slot", owner: "test", props: {}, children: [], ...over };
}

const CARD_BIND = { title: "item.title", meta: "item.meta" };

function template(over: Partial<SlotNode> = {}): SlotNode {
  return slot({
    id: "tpl.item",
    kind: "ideas:card",
    owner: "ideas",
    props: { variant: "default" },
    bind: CARD_BIND,
    ...over,
  });
}

function feed(over: Partial<Collection> = {}): SlotNode {
  return slot({
    id: "ideas.feed",
    owner: "ideas",
    layout: { flow: "column", capacity: "many" },
    collection: {
      source: "ideas.feed",
      key: "id",
      select: "template",
      templates: { item: template(), pinned: template({ id: "tpl.pinned", kind: "ideas:pinned" }) },
      ...over,
    },
  });
}

function item(id: string, over: Record<string, unknown> = {}): CollectionItem {
  return { id, template: "item", ...over };
}

function idsOf(children: SlotNode[]): string[] {
  return children.map((child) => child.id);
}

function expectInstantiated(result: CollectionResult) {
  if (!result.ok) {
    throw new Error("应实例化成功: " + JSON.stringify(result.diagnostics));
  }
  return result;
}

function expectApplied(result: ReturnType<typeof applyCollectionChanges>) {
  if (!result.ok) {
    throw new Error("应应用成功: " + JSON.stringify(result.diagnostics));
  }
  return result;
}

describe("instantiateCollection：模板实例化", () => {
  it("按 items 顺序实例化三条，bind 写进 props，模板不进树", () => {
    const collectionSlot = feed();
    const result = expectInstantiated(
      instantiateCollection(collectionSlot, [
        item("42", { title: "买牛奶", meta: "刚刚" }),
        item("7", { title: "录音" }),
        item("9", { title: "读书", meta: "昨天" }),
      ]),
    );

    expect(idsOf(result.slot.children)).toEqual(["ideas.feed#42", "ideas.feed#7", "ideas.feed#9"]);
    expect(result.slot.children.map((child) => child.props.title)).toEqual([
      "买牛奶",
      "录音",
      "读书",
    ]);
    expect(result.slot.children[0]?.props).toEqual({
      variant: "default",
      title: "买牛奶",
      meta: "刚刚",
    });
    expect(result.slot.children[0]?.kind).toBe("ideas:card");
    expect(result.slot.children[0]?.owner).toBe("ideas");
    expect(result.slot.children[0]?.bind).toBeUndefined();
    expect(result.slot.collection).toBe(collectionSlot.collection);
    expect(result.diagnostics).toEqual([]);
  });

  it("按 select 选模板，模板缺失的条目只丢自己", () => {
    const result = expectInstantiated(
      instantiateCollection(feed(), [
        item("a", { title: "A" }),
        { id: "b", template: "pinned" },
        item("bad-template", { template: "ghost" }),
        { id: "no-template" },
        item("c", { title: "C" }),
      ]),
    );

    expect(idsOf(result.slot.children)).toEqual(["ideas.feed#a", "ideas.feed#b", "ideas.feed#c"]);
    expect(result.slot.children[1]?.kind).toBe("ideas:pinned");
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "E-TEMPLATE",
      "E-TEMPLATE",
    ]);
    expect(result.diagnostics[0]?.message).toContain("bad-template");
    expect(result.diagnostics[0]?.message).toContain("ghost");
    expect(result.diagnostics[0]?.message).toContain("ideas.feed");
    expect(result.diagnostics[1]?.message).toContain("no-template");
  });

  it("空 items 得到空 children", () => {
    const result = expectInstantiated(instantiateCollection(feed(), []));

    expect(result.slot.children).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("嵌套模板的子节点 id 由父实例 id 逐层派生，跨 key 唯一", () => {
    const nested = template({
      children: [
        slot({ id: "tpl.title", kind: "ideas:text", props: {}, bind: { text: "title" } }),
        slot({
          id: "tpl.meta",
          props: {},
          children: [slot({ id: "tpl.dot", kind: "ideas:text", props: {} })],
        }),
      ],
    });

    const result = expectInstantiated(
      instantiateCollection(feed({ templates: { item: nested } }), [
        item("42", { title: "买牛奶" }),
        item("7"),
      ]),
    );

    expect(idsOf(result.slot.children)).toEqual(["ideas.feed#42", "ideas.feed#7"]);
    expect(idsOf(result.slot.children[0]?.children ?? [])).toEqual([
      "ideas.feed#42/tpl.title",
      "ideas.feed#42/tpl.meta",
    ]);
    expect(result.slot.children[0]?.children[0]?.props.text).toBe("买牛奶");
    expect(result.slot.children[0]?.children[1]?.children[0]?.id).toBe(
      "ideas.feed#42/tpl.meta/tpl.dot",
    );
    expect(idsOf(result.slot.children[1]?.children ?? [])).toEqual([
      "ideas.feed#7/tpl.title",
      "ideas.feed#7/tpl.meta",
    ]);
  });

  it("bind 支持 item.a.b 与裸字段；解析不到保留模板原值", () => {
    const binding = template({
      props: { title: "模板标题", meta: "模板 meta", deep: "模板 deep", missing: "模板缺省" },
      bind: { title: "item.title", meta: "item.a.b", deep: "a.b", missing: "item.nope" },
    });

    const result = expectInstantiated(
      instantiateCollection(feed({ templates: { item: binding } }), [
        item("42", { title: "买牛奶", a: { b: "深层值" } }),
      ]),
    );

    expect(result.slot.children[0]?.props).toEqual({
      title: "买牛奶",
      meta: "深层值",
      deep: "深层值",
      missing: "模板缺省",
    });
  });

  it("bind 路径解析：item 前缀可省，未知路径与空路径解析不到", () => {
    const data = { title: "标题", a: { b: 3 } };

    expect(resolveBindPath(data, "item.title")).toBe("标题");
    expect(resolveBindPath(data, "item.a.b")).toBe(3);
    expect(resolveBindPath(data, "a.b")).toBe(3);
    expect(resolveBindPath(data, "title")).toBe("标题");
    expect(resolveBindPath(data, "item.nope")).toBeUndefined();
    expect(resolveBindPath(data, "")).toBeUndefined();
    expect(resolveBindPath(data, "a.b.c")).toBeUndefined();
  });

  it("重复 key 只保留第一条并记 E-ID-DUPLICATE", () => {
    const result = expectInstantiated(
      instantiateCollection(feed(), [
        item("42", { title: "第一条" }),
        item("42", { title: "第二条" }),
        item("7"),
      ]),
    );

    expect(idsOf(result.slot.children)).toEqual(["ideas.feed#42", "ideas.feed#7"]);
    expect(result.slot.children[0]?.props.title).toBe("第一条");
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["E-ID-DUPLICATE"]);
    expect(result.diagnostics[0]?.message).toContain("42");
  });

  it("坏条目：非对象 / 缺 key / 缺 select / 模板不存在，只丢自己", () => {
    const result = expectInstantiated(
      instantiateCollection(feed(), [
        "not-an-object",
        { template: "item" },
        { id: 42, template: "item" },
        { id: "no-select" },
        { id: "ghost", template: "ghost" },
        item("ok-1", { title: "好条目" }),
      ]),
    );

    expect(idsOf(result.slot.children)).toEqual(["ideas.feed#ok-1"]);
    expect(result.slot.children[0]?.props.title).toBe("好条目");
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "E-TEMPLATE",
      "E-TEMPLATE",
      "E-TEMPLATE",
      "E-TEMPLATE",
      "E-TEMPLATE",
    ]);
    for (const diagnostic of result.diagnostics) {
      expect(diagnostic.severity).toBe("error");
      expect(diagnostic.slot).toBe("ideas.feed");
      expect(diagnostic.owner).toBe("ideas");
    }
    expect(result.diagnostics[4]?.message).toContain("ghost");
  });

  it("slot 没有 collection：E-PAYLOAD、ok:false、原 slot 不变", () => {
    const plain = slot({ id: "ideas.feed", owner: "ideas" });
    const snapshot = structuredClone(plain);

    const result = instantiateCollection(plain, [item("42")]);

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("没有 collection 不应实例化");
    }
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["E-PAYLOAD"]);
    expect(result.diagnostics[0]?.message).toContain("ideas.feed");
    expect(plain).toEqual(snapshot);
  });

  it("实例化结果仍是合法的 Slot 文档", () => {
    const result = expectInstantiated(
      instantiateCollection(feed(), [item("42", { title: "x" }), item("7", { title: "y" })]),
    );

    expect(() =>
      parseDocument({
        schema: DOCUMENT_SCHEMA,
        document: result.slot,
        pages: [],
        active: "",
        data: {},
        version: 1,
      }),
    ).not.toThrow();
  });
});

describe("applyCollectionChanges：keyed reconcile", () => {
  it("增量结果与用最终条目全量实例化一致", () => {
    const initial = [
      item("a", { title: "A" }),
      item("b", { title: "B" }),
      item("c", { title: "C" }),
    ];
    const changes: CollectionChange[] = [
      { kind: "insert", key: "d", at: 0, item: item("d", { title: "D" }) },
      { kind: "update", key: "b", item: { title: "B2" } },
      { kind: "remove", key: "a" },
      { kind: "move", key: "c", at: 0 },
    ];

    const incremental = expectApplied(applyCollectionChanges(feed(), initial, changes));

    expect(incremental.items.map((entry) => entry.id)).toEqual(["c", "d", "b"]);
    expect(idsOf(incremental.slot.children)).toEqual([
      "ideas.feed#c",
      "ideas.feed#d",
      "ideas.feed#b",
    ]);
    expect(incremental.diagnostics).toEqual([]);
    const full = expectInstantiated(instantiateCollection(feed(), incremental.items));
    expect(incremental.slot).toEqual(full.slot);
  });

  it("update 后同 key 的实例 id 不变，只换绑定值", () => {
    const before = expectApplied(
      applyCollectionChanges(feed(), [item("a", { title: "A" }), item("b", { title: "B" })], []),
    );

    const after = expectApplied(
      applyCollectionChanges(before.slot, before.items, [
        { kind: "update", key: "b", item: { title: "B2" } },
      ]),
    );

    expect(idsOf(after.slot.children)).toEqual(idsOf(before.slot.children));
    expect(after.slot.children[1]?.id).toBe("ideas.feed#b");
    expect(after.slot.children[1]?.props.title).toBe("B2");
    expect(after.slot.children[0]?.props.title).toBe("A");
  });

  it("insert 在 at 插入、remove 删除、move 到 at 的顺序", () => {
    const first = expectApplied(
      applyCollectionChanges(
        feed(),
        [item("a"), item("b"), item("c")],
        [{ kind: "insert", key: "d", at: 1, item: item("d") }],
      ),
    );
    expect(idsOf(first.slot.children)).toEqual([
      "ideas.feed#a",
      "ideas.feed#d",
      "ideas.feed#b",
      "ideas.feed#c",
    ]);

    const second = expectApplied(
      applyCollectionChanges(first.slot, first.items, [{ kind: "remove", key: "b" }]),
    );
    expect(idsOf(second.slot.children)).toEqual(["ideas.feed#a", "ideas.feed#d", "ideas.feed#c"]);

    const third = expectApplied(
      applyCollectionChanges(second.slot, second.items, [{ kind: "move", key: "c", at: 0 }]),
    );
    expect(idsOf(third.slot.children)).toEqual(["ideas.feed#c", "ideas.feed#a", "ideas.feed#d"]);
  });

  it("坏 change 记 E-PAYLOAD 并保守处理：跳过 / 追加 / 保持原位", () => {
    const result = expectApplied(
      applyCollectionChanges(
        feed(),
        [item("a"), item("b"), item("c")],
        [
          { kind: "update", key: "ghost", item: { title: "X" } },
          { kind: "remove", key: "ghost" },
          { kind: "move", key: "ghost", at: 0 },
          { kind: "insert", key: "a", item: item("a") },
          { kind: "insert", key: "d", at: -1, item: item("d") },
          { kind: "move", key: "a", at: 1.5 },
          { kind: "rename", key: "a" },
          "nope",
          { kind: "insert", key: "e", item: { template: "item" } },
        ],
      ),
    );

    expect(idsOf(result.slot.children)).toEqual([
      "ideas.feed#a",
      "ideas.feed#b",
      "ideas.feed#c",
      "ideas.feed#d",
      "ideas.feed#e",
    ]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "E-PAYLOAD",
      "E-PAYLOAD",
      "E-PAYLOAD",
      "E-PAYLOAD",
      "E-PAYLOAD",
      "E-PAYLOAD",
      "E-PAYLOAD",
      "E-PAYLOAD",
    ]);
    expect(result.diagnostics.every((diagnostic) => diagnostic.slot === "ideas.feed")).toBe(true);
    expect(result.diagnostics[0]?.message).toContain("ghost");
    expect(result.diagnostics[4]?.message).toContain("at");
    expect(result.items[4]?.id).toBe("e");
  });

  it("增量里的坏条目只丢自己，其余照常实例化", () => {
    const result = expectApplied(
      applyCollectionChanges(
        feed(),
        [item("a")],
        [
          { kind: "insert", key: "ghost", item: item("ghost", { template: "ghost" }) },
          { kind: "insert", key: "b", item: item("b", { title: "B" }) },
        ],
      ),
    );

    expect(idsOf(result.slot.children)).toEqual(["ideas.feed#a", "ideas.feed#b"]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["E-TEMPLATE"]);
    expect(result.items.map((entry) => entry.id)).toEqual(["a", "ghost", "b"]);
  });

  it("slot 没有 collection：ok:false、入参不变", () => {
    const plain = slot({ id: "ideas.feed" });
    const items = [item("a")];
    const snapshot = structuredClone(items);

    const result = applyCollectionChanges(plain, items, [{ kind: "remove", key: "a" }]);

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("没有 collection 不应应用增量");
    }
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["E-PAYLOAD"]);
    expect(items).toEqual(snapshot);
  });

  it("不改入参 items 与 changes", () => {
    const items = [item("a", { title: "A" })];
    const itemsSnapshot = structuredClone(items);
    const changes: CollectionChange[] = [{ kind: "update", key: "a", item: { title: "A2" } }];
    const changesSnapshot = structuredClone(changes);

    const result = expectApplied(applyCollectionChanges(feed(), items, changes));

    expect(items).toEqual(itemsSnapshot);
    expect(changes).toEqual(changesSnapshot);
    expect(result.slot.children[0]?.props.title).toBe("A2");
  });
});

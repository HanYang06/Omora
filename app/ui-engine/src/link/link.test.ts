import { describe, expect, it } from "vitest";
import { DOCUMENT_SCHEMA, parseDocument } from "../core/document";
import { link } from "./link";
import { WINDOW_SCAFFOLD } from "./scaffold";
import type { LocalTree, LocalTreesPayload } from "./types";
import { expectLinked, fixturePayload, payloadOf, slot, tree } from "./test_fixtures";

function linkFixture(payload: LocalTreesPayload = fixturePayload()) {
  return link(WINDOW_SCAFFOLD, payload);
}

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) {
    return [items.slice()];
  }
  const result: T[][] = [];
  items.forEach((item, index) => {
    const rest = [...items.slice(0, index), ...items.slice(index + 1)];
    for (const permutation of permutations(rest)) {
      result.push([item, ...permutation]);
    }
  });
  return result;
}

const EXPECTED_FIXTURE_IDS = [
  "dendro.window",
  "dendro.window.nav",
  "dendro.window.page",
  "ideas.feed",
  "ideas.feed#42",
  "ideas.feed#7",
  "ideas.new",
  "ideas.search",
  "ideas.toolbar",
  "nav.ideas",
  "page.ideas",
];

describe("WINDOW_SCAFFOLD", () => {
  it("窗口根 flow row；nav 宽 56、capacity many；page capacity one", () => {
    expect(WINDOW_SCAFFOLD.kind).toBe("dendro:window");
    expect(WINDOW_SCAFFOLD.layout?.flow).toBe("row");

    const nav = WINDOW_SCAFFOLD.children.find((child) => child.id === "dendro.window.nav");
    expect(nav?.layout?.size?.width).toBe(56);
    expect(nav?.layout?.capacity).toBe("many");

    const page = WINDOW_SCAFFOLD.children.find((child) => child.id === "dendro.window.page");
    expect(page?.layout?.capacity).toBe("one");
  });
});

describe("link：共享 fixture → 权威根树", () => {
  it("把四棵局部树链接到窗口骨架", () => {
    const result = expectLinked(linkFixture());

    expect(result.tree.id).toBe("dendro.window");
    expect(result.tree.children.map((child) => child.id)).toEqual([
      "dendro.window.nav",
      "dendro.window.page",
    ]);
    expect(result.ids.get("dendro.window.nav")?.children.map((child) => child.id)).toEqual([
      "nav.ideas",
    ]);
    expect(result.ids.get("dendro.window.page")?.children.map((child) => child.id)).toEqual([
      "page.ideas",
    ]);
  });

  it("同 slot 的多份挂载按 (order, seq) 排：feed 子顺序固定", () => {
    const result = expectLinked(linkFixture());

    const feed = result.ids.get("ideas.feed");
    expect(feed?.children.map((child) => child.id)).toEqual(["ideas.feed#42", "ideas.feed#7"]);
    expect(feed?.children[0]?.props.title).toBe("买牛奶");
    expect(feed?.children[1]?.props.title).toBe("录音");
  });

  it("ids 索引覆盖整棵根树（含跨树引入的 slot）", () => {
    const result = expectLinked(linkFixture());

    expect([...result.ids.keys()].sort()).toEqual(EXPECTED_FIXTURE_IDS);
    expect(result.ids.get("ideas.search")?.props.placeholder).toBe("搜索");
    expect(result.ids.get("ideas.new")?.events?.click).toBe("h1");
  });

  it("ids 索引包含 collection.templates 里的节点", () => {
    const root = slot({
      id: "t.root",
      collection: {
        source: "t.items",
        key: "id",
        select: "template",
        templates: { item: slot({ id: "t.item" }) },
      },
    });

    const result = expectLinked(link(WINDOW_SCAFFOLD, payloadOf([tree({ root })])));

    expect(result.ids.has("t.root")).toBe(true);
    expect(result.ids.has("t.item")).toBe(true);
  });

  it("产出的根树仍是合法 v2 文档", () => {
    const result = expectLinked(linkFixture());

    expect(() =>
      parseDocument({
        schema: DOCUMENT_SCHEMA,
        document: result.tree,
        pages: [],
        active: "",
        data: {},
        version: 1,
      }),
    ).not.toThrow();
  });

  it("乱序到达得到同一棵树", () => {
    const payload = fixturePayload();
    const linkedTrees = permutations(payload.trees).map(
      (trees) => expectLinked(link(WINDOW_SCAFFOLD, payloadOf(trees, payload.seq))).tree,
    );

    expect(linkedTrees).toHaveLength(24);
    const first = JSON.stringify(linkedTrees[0]);
    for (const candidate of linkedTrees) {
      expect(JSON.stringify(candidate)).toBe(first);
    }
  });

  it("同一棵局部树重复到达结果不变（幂等）", () => {
    const payload = fixturePayload();
    const repeated = payload.trees[2];
    if (repeated === undefined) {
      throw new Error("fixture 少了 ideas.feed 挂载树");
    }
    const once = expectLinked(linkFixture(payload));
    const twice = expectLinked(
      link(WINDOW_SCAFFOLD, payloadOf([...payload.trees, structuredClone(repeated)], payload.seq)),
    );

    expect(JSON.stringify(twice.tree)).toBe(JSON.stringify(once.tree));
    expect([...twice.ids.keys()].sort()).toEqual([...once.ids.keys()].sort());
  });

  it("对同一 payload 重复链接结果一致", () => {
    const payload = fixturePayload();
    const first = expectLinked(linkFixture(payload));
    const second = expectLinked(linkFixture(payload));

    expect(second.tree).toEqual(first.tree);
    expect(new Map(second.ids)).toEqual(new Map(first.ids));
  });

  it("不改入参：base 与 payload 链接后保持原样", () => {
    const baseCopy = structuredClone(WINDOW_SCAFFOLD);
    const payload = fixturePayload();
    const payloadCopy = structuredClone(payload);

    link(WINDOW_SCAFFOLD, payload);

    expect(WINDOW_SCAFFOLD).toEqual(baseCopy);
    expect(payload).toEqual(payloadCopy);
  });

  it("失败只回诊断，不产出树", () => {
    const result = link(
      WINDOW_SCAFFOLD,
      payloadOf([tree({ root: slot({ id: "t.root" }), mountAt: "ghost.slot" })]),
    );

    expect(result.ok).toBe(false);
    expect("tree" in result).toBe(false);
  });
});

describe("link：replace 与容量", () => {
  it("replace 独占 slot：替换既有子节点，旧 id 从索引消失", () => {
    const base = slot({
      id: "root",
      layout: { flow: "column", capacity: "many" },
      children: [
        slot({
          id: "root.area",
          layout: { flow: "column", capacity: "many" },
          children: [slot({ id: "old", owner: "base" })],
        }),
      ],
    });

    const result = expectLinked(
      link(
        base,
        payloadOf([
          tree({
            owner: "a",
            mountAt: "root.area",
            replace: true,
            root: slot({ id: "new", owner: "a" }),
          }),
        ]),
      ),
    );

    expect(result.ids.get("root.area")?.children.map((child) => child.id)).toEqual(["new"]);
    expect(result.ids.has("old")).toBe(false);
  });

  it("replace 落在 capacity one 的 slot 上合法（替换后恰好一个子节点）", () => {
    const result = expectLinked(
      link(
        WINDOW_SCAFFOLD,
        payloadOf([
          tree({
            mountAt: "dendro.window.page",
            replace: true,
            root: slot({ id: "page.replaced" }),
          }),
        ]),
      ),
    );

    expect(result.ids.get("dendro.window.page")?.children.map((child) => child.id)).toEqual([
      "page.replaced",
    ]);
  });

  it("replace 后子节点数不满足 capacity 时报错", () => {
    const base = slot({ id: "root", layout: { flow: "column", capacity: "none" } });

    const result = link(
      base,
      payloadOf([tree({ mountAt: "root", replace: true, root: slot({ id: "replacement" }) })]),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain("E-SLOT-CAPACITY");
      expect(result.diagnostics[0]?.message).toContain("none");
    }
  });

  it("replace 清掉的子树不能再被其他树当作落点", () => {
    const base = slot({
      id: "root",
      layout: { flow: "column", capacity: "many" },
      children: [
        slot({
          id: "root.area",
          layout: { flow: "column", capacity: "many" },
          children: [slot({ id: "old", owner: "base" })],
        }),
      ],
    });
    const trees: LocalTree[] = [
      tree({
        owner: "a",
        mountAt: "root.area",
        order: 10,
        replace: true,
        root: slot({ id: "new", owner: "a" }),
      }),
      tree({ owner: "b", mountAt: "old", order: 20, root: slot({ id: "b.node", owner: "b" }) }),
    ];

    const forward = link(base, payloadOf(trees));
    const backward = link(base, payloadOf([...trees].reverse()));

    expect(forward.ok).toBe(false);
    expect(backward.ok).toBe(false);
    if (!forward.ok && !backward.ok) {
      expect(forward.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
        "E-TARGET-MISSING",
      );
      expect(backward.diagnostics).toEqual(forward.diagnostics);
    }
  });
});

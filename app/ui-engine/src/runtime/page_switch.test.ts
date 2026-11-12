import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseDocument, type SlotNode } from "../core/document";
import { diffPageTrees, type PageSwitchPlan } from "./page_switch";

const DOCUMENT_FIXTURE_PATH = fileURLToPath(
  new URL("../../../sdk/tests/fixtures/document.json", import.meta.url),
);

/** 最小 Slot：测试只关心 id 与 children，其余字段给合法默认值。 */
function node(over: Partial<SlotNode> & { id: string }): SlotNode {
  return { kind: "dendro:slot", owner: "test", props: {}, children: [], ...over };
}

function leaf(id: string): SlotNode {
  return node({ id });
}

function page(id: string, children: SlotNode[] = []): SlotNode {
  return node({ id, kind: "dendro:page", owner: "ideas", children });
}

function planWith(over: Partial<PageSwitchPlan>): PageSwitchPlan {
  return { keep: [], move: [], replace: [], cancel: [], add: [], ...over };
}

/** 测试侧独立按 pre-order 收集 live id（只走 children，用于不变量断言）。 */
function liveIds(root: SlotNode): string[] {
  const out: string[] = [];
  const walk = (item: SlotNode): void => {
    out.push(item.id);
    for (const child of item.children) {
      walk(child);
    }
  };
  walk(root);
  return out;
}

function sorted(ids: string[]): string[] {
  return [...ids].sort();
}

/** 每个 live 节点必须恰好落在一个分类里；替换对的两端分别消耗旧 / 新节点。 */
function expectPartition(previous: SlotNode, next: SlotNode, plan: PageSwitchPlan): void {
  const oldIds = liveIds(previous);
  const newIds = liveIds(next);
  const replacedFrom = plan.replace.map((pair) => pair.from);
  const replacedTo = plan.replace.map((pair) => pair.to);
  expect(sorted([...plan.keep, ...plan.move, ...plan.cancel, ...replacedFrom])).toEqual(
    sorted(oldIds),
  );
  expect(sorted([...plan.keep, ...plan.move, ...plan.add, ...replacedTo])).toEqual(sorted(newIds));
}

describe("diffPageTrees：按 id 分类", () => {
  it("完全相同的树全部 keep，且没有增删改移", () => {
    const tree = page("page.ideas", [
      node({ id: "ideas.feed", children: [leaf("ideas.feed#42")] }),
      leaf("ideas.search"),
    ]);

    const plan = diffPageTrees(tree, structuredClone(tree));

    expect(plan).toEqual(
      planWith({ keep: ["page.ideas", "ideas.feed", "ideas.feed#42", "ideas.search"] }),
    );
    expectPartition(tree, tree, plan);
  });

  it("兄弟换序 → 换序的兄弟全部 move，顺序按新树 pre-order", () => {
    const previous = page("page.ideas", [leaf("a"), leaf("b"), leaf("c")]);
    const next = page("page.ideas", [leaf("c"), leaf("a"), leaf("b")]);

    const plan = diffPageTrees(previous, next);

    expect(plan).toEqual(planWith({ keep: ["page.ideas"], move: ["c", "a", "b"] }));
    expectPartition(previous, next, plan);
  });

  it("中间插入 → 新节点 add；被挤后的兄弟因序号变化 move", () => {
    const previous = page("page.ideas", [leaf("a"), leaf("b")]);
    const next = page("page.ideas", [leaf("a"), leaf("c"), leaf("b")]);

    const plan = diffPageTrees(previous, next);

    expect(plan).toEqual(planWith({ keep: ["page.ideas", "a"], move: ["b"], add: ["c"] }));
    expectPartition(previous, next, plan);
  });

  it("删除节点 → cancel，其余 keep", () => {
    const previous = page("page.ideas", [leaf("a"), leaf("b")]);
    const next = page("page.ideas", [leaf("a")]);

    const plan = diffPageTrees(previous, next);

    expect(plan).toEqual(planWith({ keep: ["page.ideas", "a"], cancel: ["b"] }));
    expectPartition(previous, next, plan);
  });

  it("同父同序号换 id → replace，旧的不进 cancel、新的不进 add", () => {
    const previous = page("page.ideas", [leaf("a"), leaf("b"), leaf("c")]);
    const next = page("page.ideas", [leaf("a"), leaf("x"), leaf("y")]);

    const plan = diffPageTrees(previous, next);

    expect(plan).toEqual(
      planWith({
        keep: ["page.ideas", "a"],
        replace: [
          { from: "b", to: "x" },
          { from: "c", to: "y" },
        ],
      }),
    );
    expectPartition(previous, next, plan);
  });

  it("嵌套子树：父 keep，子层按同槽位规则 replace / add / cancel", () => {
    const keepParent = (children: SlotNode[]): SlotNode =>
      page("page.ideas", [node({ id: "p", children })]);

    // 子层同父同序号换 id → replace 在子层发生，不波及父。
    const replaced = diffPageTrees(keepParent([leaf("x")]), keepParent([leaf("y")]));
    expect(replaced).toEqual(
      planWith({ keep: ["page.ideas", "p"], replace: [{ from: "x", to: "y" }] }),
    );

    // 子层尾部新增 / 删除。
    expect(diffPageTrees(keepParent([leaf("x")]), keepParent([leaf("x"), leaf("z")]))).toEqual(
      planWith({ keep: ["page.ideas", "p", "x"], add: ["z"] }),
    );

    const previous = keepParent([leaf("x"), leaf("z")]);
    const next = keepParent([leaf("x")]);
    const removed = diffPageTrees(previous, next);
    expect(removed).toEqual(planWith({ keep: ["page.ideas", "p", "x"], cancel: ["z"] }));
    expectPartition(previous, next, removed);
  });

  it("同 id 换父 → move（实例保留，不重建）", () => {
    const previous = page("page.ideas", [node({ id: "p", children: [leaf("x")] }), leaf("q")]);
    const next = page("page.ideas", [leaf("p"), node({ id: "q", children: [leaf("x")] })]);

    const plan = diffPageTrees(previous, next);

    expect(plan).toEqual(planWith({ keep: ["page.ideas", "p", "q"], move: ["x"] }));
    expectPartition(previous, next, plan);
  });

  it("previous 为 null → 新树整棵进 add（含根，pre-order）", () => {
    const next = page("page.ideas", [node({ id: "a", children: [leaf("a1")] }), leaf("b")]);

    const plan = diffPageTrees(null, next);

    expect(plan).toEqual(planWith({ add: ["page.ideas", "a", "a1", "b"] }));
  });

  it("根 id 变化 → replace 根；后代仍按 id / 父 / 序号分类", () => {
    const previous = page("page.ideas", [leaf("a"), leaf("b")]);
    const next = page("page.detail", [leaf("a"), leaf("c")]);

    const plan = diffPageTrees(previous, next);

    // a 同 id 但父从 page.ideas 变成 page.detail → move；b / c 父不同，
    // 不构成同槽位替换，各自 cancel / add。
    expect(plan).toEqual(
      planWith({
        move: ["a"],
        replace: [{ from: "page.ideas", to: "page.detail" }],
        cancel: ["b"],
        add: ["c"],
      }),
    );
    expectPartition(previous, next, plan);
  });

  it("已配对（move）的旧节点不会与新节点再组成 replace", () => {
    const previous = page("page.ideas", [leaf("a"), leaf("b")]);
    const next = page("page.ideas", [leaf("b"), leaf("c")]);

    // b 从序号 1 移到 0（move）；a 取消、c 新增。位置 0 虽换成 b，但 b 没卸载。
    const plan = diffPageTrees(previous, next);

    expect(plan).toEqual(
      planWith({ keep: ["page.ideas"], move: ["b"], cancel: ["a"], add: ["c"] }),
    );
    expectPartition(previous, next, plan);
  });

  it("collection.templates 不参与 diff：模板 id 不进分类，也不参与同 id 配对", () => {
    const withTemplate = (templateId: string): SlotNode =>
      page("page.ideas", [
        node({
          id: "ideas.feed",
          collection: {
            source: "ideas.feed",
            key: "id",
            select: "template",
            templates: { item: leaf(templateId) },
          },
        }),
      ]);

    const templateChanged = diffPageTrees(withTemplate("tpl.card"), withTemplate("tpl.other"));
    expect(templateChanged).toEqual(planWith({ keep: ["page.ideas", "ideas.feed"] }));

    // 旧树模板里有个 ghost，新树把 ghost 当 live 子节点：模板不占 id，ghost 是 add。
    const ghostLive = diffPageTrees(
      withTemplate("ghost"),
      page("page.ideas", [node({ id: "ideas.feed" }), leaf("ghost")]),
    );
    expect(ghostLive).toEqual(planWith({ keep: ["page.ideas", "ideas.feed"], add: ["ghost"] }));
  });

  it("重复 id 防御：文档序先到先得，不抛", () => {
    const previous = page("page.ideas", [leaf("dup"), leaf("dup")]);
    const next = page("page.ideas", [leaf("dup")]);

    const oldExtra = diffPageTrees(previous, next);
    expect(oldExtra).toEqual(planWith({ keep: ["page.ideas", "dup"], cancel: ["dup"] }));

    const newExtra = diffPageTrees(next, page("page.ideas", [leaf("dup"), leaf("dup")]));
    expect(newExtra).toEqual(planWith({ keep: ["page.ideas", "dup"], add: ["dup"] }));
  });

  it("确定性：同输入同输出，且不改入参", () => {
    const previous = page("page.ideas", [
      node({ id: "ideas.feed", children: [leaf("ideas.feed#42")] }),
      leaf("ideas.search"),
    ]);
    const next = page("page.ideas", [
      leaf("ideas.search"),
      node({ id: "ideas.feed", children: [leaf("ideas.feed#42"), leaf("ideas.feed#7")] }),
    ]);
    const before = structuredClone(previous);
    const after = structuredClone(next);

    const first = diffPageTrees(previous, next);
    const second = diffPageTrees(previous, next);

    expect(first).toEqual(second);
    expect(previous).toEqual(before);
    expect(next).toEqual(after);
    expectPartition(previous, next, first);
  });

  it("共享 document.json：活动页 live 节点参与、模板不参与", () => {
    const value: unknown = JSON.parse(readFileSync(DOCUMENT_FIXTURE_PATH, "utf8"));
    const document = parseDocument(value);
    const pageSlot = document.document.children.find((child) => child.id === "dendro.window.page");
    const ideas = pageSlot?.children.find((child) => child.id === "page.ideas");
    expect(ideas).toBeDefined();
    if (ideas === undefined) {
      return;
    }

    const same = diffPageTrees(ideas, structuredClone(ideas));
    // ideas.feed 的 children 是空的（尚未水合），模板 tpl.ideas.item 不参与。
    expect(same).toEqual(planWith({ keep: ["page.ideas", "ideas.feed"] }));

    const emptied = structuredClone(ideas);
    emptied.children = [];
    expect(diffPageTrees(ideas, emptied)).toEqual(
      planWith({ keep: ["page.ideas"], cancel: ["ideas.feed"] }),
    );
  });
});

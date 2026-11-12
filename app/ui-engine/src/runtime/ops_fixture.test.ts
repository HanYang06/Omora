import { describe, expect, it } from "vitest";
import type { SlotNode } from "../core/document";
import { DocumentIndex } from "./document";
import { applyOps, parseOps, type OpsBatch } from "./ops";
import { expectApplied, node, readOpsFixture, stateOf } from "./test_fixtures";

/**
 * base 必须与共享 fixture 的 id 对得上：
 * root → ideas.feed [ideas.feed#42, ideas.feed#7] + ideas.search，版本 16。
 * 最终期望树手工构造，用来钉住「任意更新序列后 == 终态全量构造」的收敛不变量。
 */
function fixtureBase(): SlotNode {
  return node({
    id: "dendro.window",
    kind: "dendro:window",
    owner: "ideas",
    layout: { flow: "column", capacity: "many" },
    children: [
      node({
        id: "ideas.feed",
        owner: "ideas",
        layout: { flow: "column", capacity: "many" },
        children: [
          node({
            id: "ideas.feed#42",
            kind: "ideas:card",
            owner: "ideas",
            props: { title: "买牛奶" },
          }),
          node({
            id: "ideas.feed#7",
            kind: "ideas:card",
            owner: "ideas",
            props: { title: "录音" },
          }),
        ],
      }),
      node({
        id: "ideas.search",
        kind: "dendro:search",
        owner: "ideas",
        props: { placeholder: "搜索灵感", value: "旧" },
      }),
    ],
  });
}

function expectedFinalTree(): SlotNode {
  return node({
    id: "dendro.window",
    kind: "dendro:window",
    owner: "ideas",
    layout: { flow: "column", capacity: "many" },
    children: [
      node({
        id: "ideas.feed",
        owner: "ideas",
        layout: { flow: "column", capacity: "many" },
        children: [
          node({
            id: "ideas.feed#7",
            kind: "ideas:card",
            owner: "ideas",
            props: { title: "录音" },
          }),
          node({
            id: "ideas.feed#42",
            kind: "ideas:card",
            owner: "ideas",
            props: { title: "买牛奶" },
          }),
        ],
      }),
      node({
        id: "ideas.search2",
        kind: "dendro:search",
        owner: "ideas",
        props: { placeholder: "再搜" },
      }),
    ],
  });
}

function fixtureBatch(): OpsBatch {
  const parsed = parseOps(readOpsFixture());
  if (!parsed.ok) {
    throw new Error("共享 fixture 应能解析: " + JSON.stringify(parsed.diagnostics));
  }
  return parsed.batch;
}

describe("共享 ops fixture：解析", () => {
  it("线上形状归一化成 5 个 op", () => {
    const batch = fixtureBatch();

    expect(batch).toMatchObject({ kind: "ops", document: 17, base: 16, seq: 42 });
    expect(batch.ops.map((op) => op.op)).toEqual(["update", "mount", "move", "unmount", "replace"]);
    expect(batch.ops[1]).toMatchObject({ op: "mount", slot: "ideas.feed", at: 1 });
    const mount = batch.ops[1];
    if (mount?.op !== "mount") {
      throw new Error("第二个 op 应是 mount");
    }
    expect(mount.node).toMatchObject({ id: "ideas.feed#43", kind: "ideas:card", owner: "ideas" });
    expect(batch.ops[4]).toMatchObject({ op: "replace", id: "ideas.search" });
  });
});

describe("共享 ops fixture：应用与收敛", () => {
  it("base 版本 16，ops 从 base 对得上的 id 开始", () => {
    const index = DocumentIndex.build(fixtureBase());

    expect(stateOf(fixtureBase(), 16).version).toBe(16);
    for (const id of ["ideas.feed", "ideas.search", "ideas.feed#42", "ideas.feed#7"]) {
      expect(index.get(id)?.id).toBe(id);
    }
  });

  it("应用后版本 17：feed 顺序 [7,42]，search 换成 search2", () => {
    const result = expectApplied(applyOps(stateOf(fixtureBase(), 16), fixtureBatch()));

    expect(result.state.version).toBe(17);
    const feed = result.state.root.children[0];
    expect(feed?.children.map((child) => child.id)).toEqual(["ideas.feed#7", "ideas.feed#42"]);
    const search = result.state.root.children[1];
    expect(search?.id).toBe("ideas.search2");
    expect(search?.props).toEqual({ placeholder: "再搜" });
  });

  it("changed 是触碰到的子树根 id，按首次触碰顺序去重", () => {
    const result = expectApplied(applyOps(stateOf(fixtureBase(), 16), fixtureBatch()));

    expect(result.changed).toEqual([
      "ideas.search",
      "ideas.feed#43",
      "ideas.feed#7",
      "ideas.search2",
    ]);
  });

  it("单独应用 update：props 浅合并保留原键、覆盖同键", () => {
    const batch = fixtureBatch();
    const update = batch.ops[0];
    if (update === undefined) {
      throw new Error("fixture 应有 update");
    }
    const result = expectApplied(applyOps(stateOf(fixtureBase(), 16), { ...batch, ops: [update] }));

    expect(result.state.version).toBe(17);
    expect(DocumentIndex.build(result.state.root).get("ideas.search")?.props).toEqual({
      placeholder: "搜索灵感",
      value: "录音",
    });
  });

  it("收敛：应用后的树 == 手工构造的终态树，索引逐项一致", () => {
    const result = expectApplied(applyOps(stateOf(fixtureBase(), 16), fixtureBatch()));
    const expected = expectedFinalTree();

    expect(result.state.root).toEqual(expected);

    const actualIndex = DocumentIndex.build(result.state.root);
    const expectedIndex = DocumentIndex.build(expected);
    expect(actualIndex.size).toBe(expectedIndex.size);
    expect(actualIndex.ids()).toEqual(expectedIndex.ids());
    for (const id of expectedIndex.ids()) {
      expect(actualIndex.get(id)).toEqual(expectedIndex.get(id));
      expect(actualIndex.parentOf(id)).toEqual(expectedIndex.parentOf(id));
      expect(actualIndex.childrenOf(id).map((child) => child.id)).toEqual(
        expectedIndex.childrenOf(id).map((child) => child.id),
      );
    }
    expect(actualIndex.slotsFor("ideas.feed")).toEqual(expectedIndex.slotsFor("ideas.feed"));
  });

  it("应用不改写入参：state 版本与树、fixture batch 都保持原样", () => {
    const state = stateOf(fixtureBase(), 16);
    const batch = fixtureBatch();
    const stateSnapshot = structuredClone(state);
    const batchSnapshot = structuredClone(batch);

    expectApplied(applyOps(state, batch));

    expect(state).toEqual(stateSnapshot);
    expect(batch).toEqual(batchSnapshot);
  });
});

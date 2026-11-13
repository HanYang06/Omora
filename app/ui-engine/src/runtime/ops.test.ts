import { describe, expect, it } from "vitest";
import type { SlotNode } from "../contract/document";
import { DocumentIndex, type DocumentState } from "./document";
import { applyOps, type ApplyOpsResult, type OpsBatch } from "./ops";
import { batchOf, expectApplied, expectFailed, node, stateOf } from "./test_fixtures";

function baseRoot(): SlotNode {
  return node({
    id: "root",
    kind: "dendro:window",
    owner: "test",
    layout: { flow: "column", capacity: "many" },
    children: [
      node({
        id: "feed",
        layout: { flow: "column", capacity: "many" },
        children: [
          node({ id: "feed#1", props: { title: "一" } }),
          node({ id: "feed#2", props: { title: "二", nested: { a: 1, b: 2 } } }),
        ],
      }),
      node({
        id: "search",
        kind: "dendro:search",
        props: { placeholder: "搜", value: "" },
      }),
    ],
  });
}

function baseState(): DocumentState {
  return stateOf(baseRoot(), 16);
}

function apply(ops: unknown[]): ApplyOpsResult {
  return applyOps(baseState(), batchOf(ops));
}

function feedIds(state: DocumentState): string[] {
  const feed = state.root.children.find((child) => child.id === "feed");
  return (feed?.children ?? []).map((child) => child.id);
}

function nodeOf(state: DocumentState, id: string): SlotNode | undefined {
  return DocumentIndex.build(state.root).get(id);
}

describe("applyOps：版本推进与空批量", () => {
  it("空 ops 合法：只把版本推进到 document，树不变", () => {
    const state = baseState();
    const result = expectApplied(
      applyOps(state, { kind: "ops", document: 17, base: 16, seq: 1, ops: [] }),
    );

    expect(result.state.version).toBe(17);
    expect(result.state.root).toEqual(state.root);
    expect(result.changed).toEqual([]);
  });
});

describe("update：props 浅合并", () => {
  it("保留未提到的键，提到的键覆盖，嵌套对象整体替换", () => {
    const result = expectApplied(
      apply([
        { op: "update", id: "search", props: { value: "录音" } },
        { op: "update", id: "feed#2", props: { nested: { a: 9 } } },
      ]),
    );

    expect(result.state.version).toBe(17);
    expect(nodeOf(result.state, "search")?.props).toEqual({
      placeholder: "搜",
      value: "录音",
    });
    expect(nodeOf(result.state, "feed#2")?.props.nested).toEqual({ a: 9 });
    expect(result.changed).toEqual(["search", "feed#2"]);
  });

  it("update 保留节点身份与位置", () => {
    const before = baseState();
    const result = expectApplied(apply([{ op: "update", id: "feed#1", props: { title: "一改" } }]));

    expect(result.state.root.children[0]?.children[0]?.id).toBe("feed#1");
    expect(nodeOf(result.state, "feed#1")?.props.title).toBe("一改");
    expect(feedIds(before)).toEqual(feedIds(result.state));
  });
});

describe("mount：插入子树", () => {
  it("at 缺省追加到尾部", () => {
    const result = expectApplied(
      apply([{ op: "mount", slot: "feed", node: node({ id: "feed#3" }) }]),
    );

    expect(feedIds(result.state)).toEqual(["feed#1", "feed#2", "feed#3"]);
    expect(result.changed).toEqual(["feed#3"]);
  });

  it("at 指定位置", () => {
    const result = expectApplied(
      apply([{ op: "mount", slot: "feed", at: 1, node: node({ id: "feed#3" }) }]),
    );

    expect(feedIds(result.state)).toEqual(["feed#1", "feed#3", "feed#2"]);
  });

  it("at 超过长度夹到尾部", () => {
    const result = expectApplied(
      apply([{ op: "mount", slot: "feed", at: 99, node: node({ id: "feed#3" }) }]),
    );

    expect(feedIds(result.state)).toEqual(["feed#1", "feed#2", "feed#3"]);
  });

  it("applyOps 对负数 at 夹到 0（线上由 parseOps 拒绝负数）", () => {
    const handBuilt: OpsBatch = {
      kind: "ops",
      document: 17,
      base: 16,
      seq: 1,
      ops: [{ op: "mount", slot: "feed", at: -3, node: node({ id: "feed#0" }) }],
    };

    const result = expectApplied(applyOps(baseState(), handBuilt));

    expect(feedIds(result.state)).toEqual(["feed#0", "feed#1", "feed#2"]);
  });

  it("挂载的子树原样进入文档", () => {
    const subtree = node({
      id: "feed#9",
      kind: "ideas:card",
      props: { title: "新" },
      children: [node({ id: "feed#9.meta" })],
    });
    const result = expectApplied(apply([{ op: "mount", slot: "feed", node: subtree }]));

    expect(nodeOf(result.state, "feed#9")?.props.title).toBe("新");
    expect(nodeOf(result.state, "feed#9.meta")?.id).toBe("feed#9.meta");
  });
});

describe("move：先删后插", () => {
  it("同槽内换位置", () => {
    const result = expectApplied(apply([{ op: "move", id: "feed#2", slot: "feed", at: 0 }]));

    expect(feedIds(result.state)).toEqual(["feed#2", "feed#1"]);
    expect(result.changed).toEqual(["feed#2"]);
  });

  it("跨槽移动（父与位置都变）", () => {
    const result = expectApplied(apply([{ op: "move", id: "feed#1", slot: "search", at: 0 }]));

    expect(feedIds(result.state)).toEqual(["feed#2"]);
    expect(nodeOf(result.state, "search")?.children.map((child) => child.id)).toEqual(["feed#1"]);
    expect(nodeOf(result.state, "feed#1")?.props.title).toBe("一");
  });

  it("同父同位置是允许的 no-op", () => {
    const before = baseState();
    const result = expectApplied(apply([{ op: "move", id: "feed#1", slot: "feed", at: 0 }]));

    expect(feedIds(result.state)).toEqual(["feed#1", "feed#2"]);
    expect(result.state.root).toEqual(before.root);
    expect(result.changed).toEqual(["feed#1"]);
  });

  it("at 超过删除后的长度夹到尾部", () => {
    const result = expectApplied(apply([{ op: "move", id: "feed#1", slot: "feed", at: 99 }]));

    expect(feedIds(result.state)).toEqual(["feed#2", "feed#1"]);
  });
});

describe("unmount：删除整棵子树", () => {
  it("删叶子只影响自己", () => {
    const result = expectApplied(apply([{ op: "unmount", id: "feed#1" }]));

    expect(feedIds(result.state)).toEqual(["feed#2"]);
    expect(nodeOf(result.state, "feed#1")).toBeUndefined();
    expect(result.changed).toEqual(["feed#1"]);
  });

  it("删容器连同全部后代一起消失，索引随之重建", () => {
    const result = expectApplied(apply([{ op: "unmount", id: "feed" }]));

    const index = DocumentIndex.build(result.state.root);
    expect(result.state.root.children.map((child) => child.id)).toEqual(["search"]);
    expect(index.ids()).toEqual(["root", "search"]);
    expect(result.changed).toEqual(["feed"]);
  });
});

describe("replace：原位换子树", () => {
  it("替换子节点保持位置，旧子树消失", () => {
    const result = expectApplied(
      apply([
        {
          op: "replace",
          id: "feed#2",
          node: node({ id: "feed#9", kind: "ideas:card", props: { title: "换" } }),
        },
      ]),
    );

    expect(feedIds(result.state)).toEqual(["feed#1", "feed#9"]);
    expect(nodeOf(result.state, "feed#2")).toBeUndefined();
    expect(nodeOf(result.state, "feed#9")?.props.title).toBe("换");
    expect(result.changed).toEqual(["feed#9"]);
  });

  it("根可替换，整棵树换掉", () => {
    const result = expectApplied(
      apply([
        {
          op: "replace",
          id: "root",
          node: node({
            id: "root2",
            kind: "dendro:window",
            children: [node({ id: "only" })],
          }),
        },
      ]),
    );

    expect(result.state.root.id).toBe("root2");
    expect(result.state.root.children.map((child) => child.id)).toEqual(["only"]);
    expect(result.changed).toEqual(["root2"]);
  });

  it("新旧子树同 id 时允许（身份保持，位置不变）", () => {
    const result = expectApplied(
      apply([
        {
          op: "replace",
          id: "feed#2",
          node: node({ id: "feed#2", kind: "ideas:card", props: { title: "二改" } }),
        },
      ]),
    );

    expect(feedIds(result.state)).toEqual(["feed#1", "feed#2"]);
    expect(nodeOf(result.state, "feed#2")?.props.title).toBe("二改");
    expect(result.changed).toEqual(["feed#2"]);
  });
});

describe("changed：触碰到的子树根 id，按首次触碰顺序去重", () => {
  it("同一个 id 被多次 update 只出现一次", () => {
    const result = expectApplied(
      apply([
        { op: "update", id: "search", props: { value: "a" } },
        { op: "update", id: "search", props: { value: "b" } },
      ]),
    );

    expect(result.changed).toEqual(["search"]);
  });

  it("mount 后紧跟 update 新节点：只记新子树根一次", () => {
    const result = expectApplied(
      apply([
        { op: "mount", slot: "feed", node: node({ id: "feed#9", props: { title: "新" } }) },
        { op: "update", id: "feed#9", props: { title: "改" } },
      ]),
    );

    expect(result.changed).toEqual(["feed#9"]);
  });

  it("mount 后又 unmount 同一 id：仍算被触碰一次", () => {
    const result = expectApplied(
      apply([
        { op: "mount", slot: "feed", node: node({ id: "feed#9" }) },
        { op: "unmount", id: "feed#9" },
      ]),
    );

    expect(result.changed).toEqual(["feed#9"]);
    expect(nodeOf(result.state, "feed#9")).toBeUndefined();
  });

  it("不同 op 按声明顺序记", () => {
    const result = expectApplied(
      apply([
        { op: "update", id: "feed#1", props: { title: "一改" } },
        { op: "move", id: "feed#2", slot: "feed", at: 0 },
        { op: "unmount", id: "search" },
      ]),
    );

    expect(result.changed).toEqual(["feed#1", "feed#2", "search"]);
  });
});

describe("原子性与入参不变", () => {
  it("批量中间失败时整批不生效，原 state 原样不动", () => {
    const state = baseState();
    const snapshot = structuredClone(state);

    const result = apply([
      { op: "update", id: "search", props: { value: "不应生效" } },
      { op: "mount", slot: "feed", node: node({ id: "feed#1" }) },
    ]);

    const diagnostics = expectFailed(result);
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["E-ID-DUPLICATE"]);
    expect(state).toEqual(snapshot);
    expect(nodeOf(state, "search")?.props.value).toBe("");
  });

  it("第二个 op 目标不存在时第一个 op 也不生效", () => {
    const state = baseState();
    const snapshot = structuredClone(state);

    const result = apply([
      { op: "update", id: "search", props: { value: "不应生效" } },
      { op: "move", id: "nope", slot: "feed", at: 0 },
    ]);

    const diagnostics = expectFailed(result);
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["E-TARGET-MISSING"]);
    expect(state).toEqual(snapshot);
  });

  it("成功的批量不改写 batch：update 不会污染 mount 的 node", () => {
    const batch = batchOf([
      { op: "mount", slot: "feed", node: node({ id: "feed#9", props: { title: "新" } }) },
      { op: "update", id: "feed#9", props: { title: "改" } },
    ]);
    const snapshot = structuredClone(batch);
    const mountOp = batch.ops[0];
    if (mountOp?.op !== "mount") {
      throw new Error("第一个 op 应是 mount");
    }

    const result = expectApplied(applyOps(baseState(), batch));

    expect(batch).toEqual(snapshot);
    expect(mountOp.node.props.title).toBe("新");
    expect(nodeOf(result.state, "feed#9")?.props.title).toBe("改");
  });

  it("成功的批量不改写 state，且新状态不与旧状态共享节点", () => {
    const state = baseState();
    const snapshot = structuredClone(state);

    const result = expectApplied(apply([{ op: "update", id: "feed#1", props: { title: "改" } }]));

    expect(state).toEqual(snapshot);
    expect(result.state.root).not.toBe(state.root);
    expect(result.state.root.children[0]).not.toBe(state.root.children[0]);
  });
});

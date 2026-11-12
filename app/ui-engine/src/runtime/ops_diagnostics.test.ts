import { describe, expect, it } from "vitest";
import type { SlotNode } from "../core/document";
import { DocumentIndex, type DocumentState } from "./document";
import { applyOps, parseOps, type OpsBatch, type ParseOpsResult } from "./ops";
import { batchOf, expectApplied, expectFailed, node, stateOf } from "./test_fixtures";

/**
 * 失败路径集中在这里：每个诊断码都能被触发，且消息/现场能定位。
 * 结构里专门留出 capacity one / none / 模板子树三种目标。
 */
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
        children: [node({ id: "feed#1" }), node({ id: "feed#2" })],
      }),
      node({
        id: "one",
        layout: { flow: "column", capacity: "one" },
        children: [node({ id: "one#1" })],
      }),
      node({ id: "empty", layout: { flow: "column", capacity: "none" } }),
      node({
        id: "collection",
        layout: { flow: "column", capacity: "many" },
        collection: {
          source: "items",
          key: "id",
          select: "template",
          templates: { item: node({ id: "tpl", children: [node({ id: "tpl.title" })] }) },
        },
      }),
    ],
  });
}

function baseState(): DocumentState {
  return stateOf(baseRoot(), 16);
}

function apply(ops: unknown[]) {
  return applyOps(baseState(), batchOf(ops));
}

function codesOf(result: ReturnType<typeof apply>): string[] {
  return expectFailed(result).map((diagnostic) => diagnostic.code);
}

function parseErrors(value: unknown) {
  const parsed: ParseOpsResult = parseOps(value);
  if (parsed.ok) {
    throw new Error("payload 应解析失败");
  }
  return parsed.diagnostics;
}

function payload(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { kind: "ops", document: 17, base: 16, seq: 1, ops: [], ...over };
}

describe("parseOps：E-PAYLOAD 形状校验（不抛）", () => {
  it.each([
    ["非对象", null],
    ["数组", []],
  ])("%s 拒绝", (_name, value) => {
    expect(parseErrors(value).map((diagnostic) => diagnostic.code)).toEqual(["E-PAYLOAD"]);
  });

  it("kind 必须正确", () => {
    const diagnostics = parseErrors(payload({ kind: "local-trees" }));

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["E-PAYLOAD"]);
    expect(diagnostics[0]?.path).toBe("$.kind");
  });

  it("document / base / seq 必须是约定范围内的整数", () => {
    expect(parseErrors(payload({ document: 1.5 })).map((d) => d.code)).toEqual(["E-PAYLOAD"]);
    expect(parseErrors(payload({ base: 0 })).map((d) => d.code)).toEqual(["E-PAYLOAD"]);
    expect(parseErrors(payload({ seq: -1 })).map((d) => d.code)).toEqual(["E-PAYLOAD"]);
    expect(parseErrors(payload({ base: "16" })).map((d) => d.code)).toEqual(["E-PAYLOAD"]);
  });

  it("ops 必须是数组", () => {
    const diagnostics = parseErrors(payload({ ops: {} }));

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["E-PAYLOAD"]);
    expect(diagnostics[0]?.path).toBe("$.ops");
  });

  it.each([
    ["op 非对象", [1]],
    ["未知 op", [{ op: "navigate", page: "x" }]],
    ["update 缺 props", [{ op: "update", id: "x" }]],
    ["update id 为空", [{ op: "update", id: "", props: {} }]],
    ["mount 缺 slot", [{ op: "mount", node: node({ id: "x" }) }]],
    ["mount at 负数", [{ op: "mount", slot: "feed", at: -1, node: node({ id: "x" }) }]],
    ["mount node 缺 id", [{ op: "mount", slot: "feed", node: { kind: "dendro:slot" } }]],
    ["mount node kind 非法", [{ op: "mount", slot: "feed", node: node({ id: "x", kind: "bad" }) }]],
    ["move 缺 at", [{ op: "move", id: "feed#1", slot: "feed" }]],
    ["move at 负数", [{ op: "move", id: "feed#1", slot: "feed", at: -1 }]],
    ["unmount 缺 id", [{ op: "unmount", props: {} }]],
    ["replace 缺 node", [{ op: "replace", id: "feed#1" }]],
  ])("%s → E-PAYLOAD", (_name, ops) => {
    expect(parseErrors(payload({ ops })).map((diagnostic) => diagnostic.code)).toEqual([
      "E-PAYLOAD",
    ]);
  });

  it("route op 解析：page 必填、params 可选对象（缺省与空对象可区分）", () => {
    const parsed = parseOps(
      payload({
        ops: [
          { op: "route", page: "page.ideas" },
          { op: "route", page: "page.detail", params: { id: "42" } },
          { op: "route", page: "page.detail", params: {} },
        ],
      }),
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.batch.ops[0]).toEqual({ op: "route", page: "page.ideas" });
    expect(parsed.batch.ops[0] !== undefined && "params" in parsed.batch.ops[0]).toBe(false);
    expect(parsed.batch.ops[1]).toEqual({
      op: "route",
      page: "page.detail",
      params: { id: "42" },
    });
    expect(parsed.batch.ops[2]).toEqual({ op: "route", page: "page.detail", params: {} });
  });

  it.each([
    ["缺 page", [{ op: "route" }]],
    ["page 为空", [{ op: "route", page: " " }]],
    ["params 是数组", [{ op: "route", page: "x", params: [] }]],
    ["params 是字符串", [{ op: "route", page: "x", params: "id" }]],
  ])("route %s → E-PAYLOAD", (_name, ops) => {
    expect(parseErrors(payload({ ops })).map((diagnostic) => diagnostic.code)).toEqual([
      "E-PAYLOAD",
    ]);
  });

  it("route 与树 op 混批时保持声明顺序", () => {
    const parsed = parseOps(
      payload({
        ops: [
          { op: "update", id: "feed#1", props: { title: "改" } },
          { op: "route", page: "page.detail", params: { id: "42" } },
          { op: "unmount", id: "feed#2" },
        ],
      }),
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.batch.ops.map((op) => op.op)).toEqual(["update", "route", "unmount"]);
  });

  it("op 内节点自身重复 id → E-ID-DUPLICATE", () => {
    const diagnostics = parseErrors(
      payload({
        ops: [
          {
            op: "mount",
            slot: "feed",
            node: node({ id: "dup", children: [node({ id: "dup" })] }),
          },
        ],
      }),
    );

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["E-ID-DUPLICATE"]);
    expect(diagnostics[0]?.path).toBe("$.ops[0].node.children[0].id");
  });

  it("合法 payload 归一化：mount 无 at 时不带 at，字段按类型收敛", () => {
    const parsed = parseOps(
      payload({
        ops: [
          { op: "mount", slot: "feed", node: node({ id: "feed#9" }) },
          { op: "mount", slot: "feed", at: 1, node: node({ id: "feed#10" }) },
        ],
      }),
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.batch).toMatchObject({ kind: "ops", document: 17, base: 16, seq: 1 });
    const first = parsed.batch.ops[0];
    const second = parsed.batch.ops[1];
    expect(first && "at" in first).toBe(false);
    expect(second).toMatchObject({ op: "mount", at: 1 });
  });
});

describe("applyOps：E-VERSION", () => {
  it("base 与当前文档版本不一致", () => {
    const state = baseState();
    const batch: OpsBatch = { kind: "ops", document: 17, base: 15, seq: 1, ops: [] };
    const diagnostics = expectFailed(applyOps(state, batch));

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["E-VERSION"]);
    expect(diagnostics[0]?.path).toBe("$.base");
  });

  it("document 不是 base + 1", () => {
    const state = baseState();
    const batch: OpsBatch = { kind: "ops", document: 18, base: 16, seq: 1, ops: [] };
    const diagnostics = expectFailed(applyOps(state, batch));

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["E-VERSION"]);
    expect(diagnostics[0]?.path).toBe("$.document");
  });
});

describe("applyOps：E-TARGET-MISSING", () => {
  it.each([
    ["update", [{ op: "update", id: "nope", props: {} }]],
    ["mount 目标槽", [{ op: "mount", slot: "nope", node: node({ id: "x" }) }]],
    ["move 节点", [{ op: "move", id: "nope", slot: "feed", at: 0 }]],
    ["move 目标槽", [{ op: "move", id: "feed#1", slot: "nope", at: 0 }]],
    ["unmount", [{ op: "unmount", id: "nope" }]],
    ["replace", [{ op: "replace", id: "nope", node: node({ id: "x" }) }]],
  ])("%s 目标不存在", (_name, ops) => {
    expect(codesOf(apply(ops))).toEqual(["E-TARGET-MISSING"]);
  });

  it("诊断带目标 id 与 op 位置", () => {
    const diagnostics = expectFailed(apply([{ op: "update", id: "nope", props: {} }]));

    expect(diagnostics[0]?.slot).toBe("nope");
    expect(diagnostics[0]?.path).toBe("$.ops[0].id");
  });
});

describe("applyOps：E-ID-DUPLICATE", () => {
  it("挂载的子树根 id 与现存文档冲突", () => {
    const diagnostics = expectFailed(
      apply([{ op: "mount", slot: "feed", node: node({ id: "feed#1" }) }]),
    );

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["E-ID-DUPLICATE"]);
    expect(diagnostics[0]?.path).toBe("$.ops[0].node");
  });

  it("挂载子树里的后代 id 与现存文档冲突", () => {
    expect(
      codesOf(
        apply([
          {
            op: "mount",
            slot: "feed",
            node: node({ id: "x", children: [node({ id: "feed#2" })] }),
          },
        ]),
      ),
    ).toEqual(["E-ID-DUPLICATE"]);
  });

  it("replace 的新 id 与移除旧子树后剩余的文档冲突", () => {
    expect(codesOf(apply([{ op: "replace", id: "feed#1", node: node({ id: "feed#2" }) }]))).toEqual(
      ["E-ID-DUPLICATE"],
    );
  });
});

describe("applyOps：E-SLOT-CAPACITY", () => {
  it("往 capacity one 且已有一个子节点的槽 mount", () => {
    expect(codesOf(apply([{ op: "mount", slot: "one", node: node({ id: "one#2" }) }]))).toEqual([
      "E-SLOT-CAPACITY",
    ]);
  });

  it("往 capacity none 的槽 mount", () => {
    expect(codesOf(apply([{ op: "mount", slot: "empty", node: node({ id: "empty#1" }) }]))).toEqual(
      ["E-SLOT-CAPACITY"],
    );
  });

  it("被挂载子树根自身 capacity 与 children 不符", () => {
    expect(
      codesOf(
        apply([
          {
            op: "mount",
            slot: "feed",
            node: node({
              id: "bad",
              layout: { flow: "column", capacity: "none" },
              children: [node({ id: "bad.child" })],
            }),
          },
        ]),
      ),
    ).toEqual(["E-SLOT-CAPACITY"]);
  });

  it("move 进容量不足的目标槽", () => {
    expect(codesOf(apply([{ op: "move", id: "feed#1", slot: "one", at: 0 }]))).toEqual([
      "E-SLOT-CAPACITY",
    ]);
  });

  it("replace 的新子树根 capacity 与 children 不符", () => {
    expect(
      codesOf(
        apply([
          {
            op: "replace",
            id: "feed#1",
            node: node({
              id: "next",
              layout: { flow: "column", capacity: "one" },
              children: [node({ id: "next.a" }), node({ id: "next.b" })],
            }),
          },
        ]),
      ),
    ).toEqual(["E-SLOT-CAPACITY"]);
  });
});

describe("applyOps：E-CYCLE", () => {
  it("移进自己的后代", () => {
    expect(codesOf(apply([{ op: "move", id: "feed", slot: "feed#1", at: 0 }]))).toEqual([
      "E-CYCLE",
    ]);
  });

  it("移进自己", () => {
    expect(codesOf(apply([{ op: "move", id: "feed#1", slot: "feed#1", at: 0 }]))).toEqual([
      "E-CYCLE",
    ]);
  });

  it("根移到子树里", () => {
    expect(codesOf(apply([{ op: "move", id: "root", slot: "feed", at: 0 }]))).toEqual(["E-CYCLE"]);
  });
});

describe("applyOps：E-PAYLOAD（结构操作不能碰模板子树 / 根）", () => {
  it("根不能卸载", () => {
    expect(codesOf(apply([{ op: "unmount", id: "root" }]))).toEqual(["E-PAYLOAD"]);
  });

  it("往模板根 mount", () => {
    expect(codesOf(apply([{ op: "mount", slot: "tpl", node: node({ id: "x" }) }]))).toEqual([
      "E-PAYLOAD",
    ]);
  });

  it("移动模板根 / 移进模板 slots", () => {
    expect(codesOf(apply([{ op: "move", id: "tpl", slot: "feed", at: 0 }]))).toEqual(["E-PAYLOAD"]);
    expect(codesOf(apply([{ op: "move", id: "feed#1", slot: "tpl", at: 0 }]))).toEqual([
      "E-PAYLOAD",
    ]);
  });

  it("卸载模板根", () => {
    expect(codesOf(apply([{ op: "unmount", id: "tpl" }]))).toEqual(["E-PAYLOAD"]);
  });

  it("替换模板根", () => {
    expect(codesOf(apply([{ op: "replace", id: "tpl", node: node({ id: "next" }) }]))).toEqual([
      "E-PAYLOAD",
    ]);
  });

  it("对照：模板内节点可以 update 内容", () => {
    const result = expectApplied(
      applyOps(baseState(), batchOf([{ op: "update", id: "tpl", props: { label: "改" } }])),
    );

    expect(DocumentIndex.build(result.state.root).get("tpl")?.props.label).toBe("改");
  });
});

describe("applyOps：route 只能走会话层", () => {
  it("route 出现在 DocumentState 层 → E-PAYLOAD，提示改走 session 层", () => {
    const diagnostics = expectFailed(apply([{ op: "route", page: "page.ideas" }]));

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["E-PAYLOAD"]);
    expect(diagnostics[0]?.message).toContain("applySessionOps");
    expect(diagnostics[0]?.path).toBe("$.ops[0].op");
  });

  it("route 与树 op 混批：整批失败，树 op 不生效、原 state 不变", () => {
    const state = baseState();
    const snapshot = structuredClone(state);

    const diagnostics = expectFailed(
      applyOps(
        state,
        batchOf([
          { op: "update", id: "feed#1", props: { title: "不应生效" } },
          { op: "route", page: "page.detail", params: { id: "42" } },
        ]),
      ),
    );

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["E-PAYLOAD"]);
    expect(state).toEqual(snapshot);
    expect(DocumentIndex.build(state.root).get("feed#1")?.props).toEqual({});
  });
});

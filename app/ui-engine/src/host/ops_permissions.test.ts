import { describe, expect, it } from "vitest";
import type { Grant, SlotNode } from "../contract/document";
import { DocumentIndex, type DocumentState } from "../engine/document/document";
import { applyOps, type OpGuard } from "../engine/document/ops";
import type { Requester } from "../contract/policy";
import { batchOf, expectApplied, expectFailed, node, stateOf } from "../engine/test_fixtures";
import { checkOpPermission } from "./permissions";

/**
 * 运行期 ops 的权限闸门：不传 guard 放行（现有测试不回归），
 * 注入受限 requester 构造的 guard 时越权 → 只回 E-PERMISSION、整批不生效、原 state 不变。
 *
 * 权限点（permissions.md §4）：
 * - update / replace → 目标节点；mount → 目标槽；unmount → 父槽 remove；
 * - move → 旧父 remove，再新目标 mount（两个条件都满足才放行）。
 */

/**
 * 线上 grant 是扁平的能力表（Python `Grant.to_json()`）；parseGrant 解析后才包成内部
 * 的 `{capabilities}`。createState 之前要在测试夹具里做这一处边界转换。
 */
function wireGrant(capabilities: Record<string, string[]>): Grant {
  return capabilities as unknown as Grant;
}

function baseRoot(): SlotNode {
  return node({
    id: "root",
    owner: "test",
    layout: { flow: "column", capacity: "many" },
    children: [
      node({
        id: "feed",
        owner: "test",
        layout: { flow: "column", capacity: "many" },
        // 卸载 / 移出 feed 的子节点要 feed 的 remove：editor 或 alice。
        grant: wireGrant({ remove: ["role:editor", "alice"] }),
        children: [
          node({
            id: "feed#1",
            owner: "test",
            grant: wireGrant({ update: ["role:editor"] }),
          }),
          node({ id: "feed#2", owner: "test" }),
        ],
      }),
      node({
        id: "search",
        owner: "test",
        grant: wireGrant({ mount: ["role:editor"], update: ["role:editor"] }),
      }),
    ],
  });
}

function baseState(): DocumentState {
  return stateOf(baseRoot(), 16);
}

const stranger: Requester = { owner: "stranger" };
const editor: Requester = { owner: "stranger", roles: ["editor"] };
const alice: Requester = { owner: "alice" };
const system: Requester = { owner: "stranger", tiers: ["system"] };
const owner: Requester = { owner: "test" };

/** 用主体构造 engine 的 op guard：host 侧的权限注入点，engine 只认 guard。 */
function guardFor(requester: Requester): OpGuard {
  return (index, op) => checkOpPermission(index, op, requester);
}

function apply(ops: unknown[], requester?: Requester): ReturnType<typeof applyOps> {
  const batch = batchOf(ops);
  return requester === undefined
    ? applyOps(baseState(), batch)
    : applyOps(baseState(), batch, { guard: guardFor(requester) });
}

function codesOf(result: ReturnType<typeof applyOps>): string[] {
  return expectFailed(result).map((diagnostic) => diagnostic.code);
}

function nodeOf(state: DocumentState, id: string): SlotNode | undefined {
  return DocumentIndex.build(state.root).get(id);
}

function idsOf(state: DocumentState, id: string): string[] {
  return (nodeOf(state, id)?.children ?? []).map((child) => child.id);
}

describe("applyOps 权限：默认放行", () => {
  it("不传 requester 等于系统来源：无 grant 的节点也能改", () => {
    const result = expectApplied(apply([{ op: "update", id: "feed#2", props: { title: "改" } }]));

    expect(nodeOf(result.state, "feed#2")?.props.title).toBe("改");
  });

  it("显式系统 tier 同样全放行", () => {
    const result = expectApplied(
      apply([{ op: "update", id: "feed#2", props: { title: "改" } }], system),
    );

    expect(nodeOf(result.state, "feed#2")?.props.title).toBe("改");
  });

  it("owner 对自己的树不需要 grant", () => {
    const result = expectApplied(
      apply(
        [
          { op: "update", id: "feed#2", props: { title: "改" } },
          { op: "mount", slot: "search", node: node({ id: "search#1", owner: "test" }) },
          { op: "move", id: "feed#2", slot: "search", at: 1 },
        ],
        owner,
      ),
    );

    expect(idsOf(result.state, "feed")).toEqual(["feed#1"]);
    expect(idsOf(result.state, "search")).toEqual(["search#1", "feed#2"]);
  });
});

describe("applyOps 权限：各 op 的目标与拒绝", () => {
  it("update：目标节点 update 能力", () => {
    expect(
      codesOf(apply([{ op: "update", id: "feed#1", props: { title: "x" } }], stranger)),
    ).toEqual(["E-PERMISSION"]);
  });

  it("mount：目标槽 mount 能力", () => {
    expect(
      codesOf(apply([{ op: "mount", slot: "search", node: node({ id: "search#1" }) }], stranger)),
    ).toEqual(["E-PERMISSION"]);
  });

  it("replace：目标节点 replace 能力（feed#1 只有 update grant）", () => {
    expect(
      codesOf(apply([{ op: "replace", id: "feed#1", node: node({ id: "feed#9" }) }], editor)),
    ).toEqual(["E-PERMISSION"]);
  });

  it("unmount：父槽 remove 能力，而不是被删节点", () => {
    const diagnostics = expectFailed(apply([{ op: "unmount", id: "feed#1" }], stranger));

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["E-PERMISSION"]);
    expect(diagnostics[0]?.slot).toBe("feed");
    expect(diagnostics[0]?.message).toContain("remove");
  });
});

describe("applyOps 权限：move 要旧父 remove + 新目标 mount 两个条件", () => {
  it("缺旧父 remove → 拒绝，诊断指向旧父", () => {
    const diagnostics = expectFailed(
      apply([{ op: "move", id: "feed#1", slot: "search", at: 0 }], stranger),
    );

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["E-PERMISSION"]);
    expect(diagnostics[0]?.slot).toBe("feed");
  });

  it("有旧父 remove 但缺新目标 mount → 拒绝，诊断指向新目标槽", () => {
    // alice 命中 feed.remove: ["alice"]，但没有 editor 角色 → search.mount 不放行。
    const state = baseState();
    const result = applyOps(state, batchOf([{ op: "move", id: "feed#1", slot: "search", at: 0 }]), {
      guard: guardFor(alice),
    });

    const diagnostics = expectFailed(result);
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["E-PERMISSION"]);
    expect(diagnostics[0]?.slot).toBe("search");
    expect(state).toEqual(baseState());
  });

  it("两个条件都满足才真正移动", () => {
    const result = expectApplied(
      apply([{ op: "move", id: "feed#1", slot: "search", at: 0 }], editor),
    );

    expect(idsOf(result.state, "feed")).toEqual(["feed#2"]);
    expect(idsOf(result.state, "search")).toEqual(["feed#1"]);
  });
});

describe("applyOps 权限：拒绝的原子性与诊断现场", () => {
  it("批量中间被拒：前面的 op 不生效，只回一条 E-PERMISSION，原 state 不变", () => {
    const state = baseState();
    const snapshot = structuredClone(state);

    const result = applyOps(
      state,
      batchOf([
        { op: "update", id: "feed#1", props: { title: "不应生效" } },
        { op: "update", id: "feed#2", props: { title: "也不应生效" } },
      ]),
      { guard: guardFor(editor) },
    );

    const diagnostics = expectFailed(result);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe("E-PERMISSION");
    expect(state).toEqual(snapshot);
    expect(nodeOf(state, "feed#1")?.props).toEqual({});
    expect(nodeOf(state, "feed#2")?.props).toEqual({});
  });

  it("诊断消息与现场能定位：含 capability、slot id、requester.owner", () => {
    const diagnostics = expectFailed(
      apply([{ op: "update", id: "feed#1", props: { title: "x" } }], { owner: "mallory" }),
    );

    const diagnostic = diagnostics[0];
    expect(diagnostic?.code).toBe("E-PERMISSION");
    expect(diagnostic?.message).toContain("update");
    expect(diagnostic?.message).toContain("feed#1");
    expect(diagnostic?.message).toContain("mallory");
    expect(diagnostic?.owner).toBe("test");
    expect(diagnostic?.slot).toBe("feed#1");
  });

  it("结构错误优先：目标不存在仍报 E-TARGET-MISSING，不被权限码顶掉", () => {
    expect(codesOf(apply([{ op: "update", id: "nope", props: {} }], stranger))).toEqual([
      "E-TARGET-MISSING",
    ]);
    expect(codesOf(apply([{ op: "move", id: "feed#2", slot: "nope", at: 0 }], stranger))).toEqual([
      "E-TARGET-MISSING",
    ]);
    // 根没有父槽，卸载根仍是结构错误 E-PAYLOAD。
    expect(codesOf(apply([{ op: "unmount", id: "root" }], stranger))).toEqual(["E-PAYLOAD"]);
  });
});

import { describe, expect, it } from "vitest";
import { parseLocalTrees } from "./parse";
import type { DiagnosticCode } from "./types";
import { fixturePayload, payloadOf, readFixture, slot, tree } from "./test_fixtures";

function codesOf(value: unknown): DiagnosticCode[] {
  const result = parseLocalTrees(value);
  expect(result.ok).toBe(false);
  if (result.ok) {
    return [];
  }
  return result.diagnostics.map((diagnostic) => diagnostic.code);
}

const validTree = tree({ owner: "x", root: slot({ id: "x.root", owner: "x" }) });

function rawTree(): Record<string, unknown> {
  return {
    owner: "x",
    mountAt: "dendro.window.page",
    order: 0,
    seq: 0,
    root: slot({ id: "x.root", owner: "x" }),
  };
}

describe("parseLocalTrees：共享 fixture 与形状校验", () => {
  it("解析共享 fixture：4 棵树，replace 归一成 false", () => {
    const payload = fixturePayload();

    expect(payload.kind).toBe("local-trees");
    expect(payload.seq).toBe(3);
    expect(payload.trees).toHaveLength(4);
    expect(payload.trees.map((localTree) => localTree.owner)).toEqual([
      "ideas",
      "dendro",
      "ideas",
      "audio",
    ]);
    expect(payload.trees[0]?.root.id).toBe("page.ideas");
    expect(payload.trees.every((localTree) => localTree.replace === false)).toBe(true);
  });

  it("允许空 trees（清空语义）", () => {
    const result = parseLocalTrees({ kind: "local-trees", seq: 0, trees: [] });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.trees).toEqual([]);
    }
  });

  it("保留 replace:true", () => {
    const result = parseLocalTrees(payloadOf([{ ...validTree, replace: true }]));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.trees[0]?.replace).toBe(true);
    }
  });

  it("相同局部树重复到达时去重（链接幂等的基础）", () => {
    const payload = fixturePayload();
    const first = payload.trees[0];
    if (first === undefined) {
      throw new Error("fixture 少了第一棵树");
    }
    const result = parseLocalTrees(payloadOf([...payload.trees, structuredClone(first)]));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.trees).toHaveLength(4);
    }
  });

  it("共享 fixture 原文件也能解析", () => {
    const result = parseLocalTrees(readFixture());
    expect(result.ok).toBe(true);
  });
});

const invalidPayloads: Array<[string, unknown, DiagnosticCode]> = [
  ["payload 不是对象", null, "E-PAYLOAD"],
  ["kind 不对", { kind: "document", seq: 1, trees: [] }, "E-PAYLOAD"],
  ["seq 是负数", { kind: "local-trees", seq: -1, trees: [] }, "E-PAYLOAD"],
  ["seq 不是整数", { kind: "local-trees", seq: 1.5, trees: [] }, "E-PAYLOAD"],
  ["trees 不是数组", { kind: "local-trees", seq: 1, trees: {} }, "E-PAYLOAD"],
  ["树不是对象", { kind: "local-trees", seq: 1, trees: [1] }, "E-PAYLOAD"],
  ["owner 为空", payloadOf([{ ...validTree, owner: "" }]), "E-PAYLOAD"],
  ["mountAt 为空", payloadOf([{ ...validTree, mountAt: " " }]), "E-PAYLOAD"],
  ["order 不是整数", payloadOf([{ ...validTree, order: 1.25 }]), "E-PAYLOAD"],
  [
    "seq 是字符串",
    { kind: "local-trees", seq: 1, trees: [{ ...rawTree(), seq: "1" }] },
    "E-PAYLOAD",
  ],
  [
    "replace 不是布尔",
    { kind: "local-trees", seq: 1, trees: [{ ...rawTree(), replace: "true" }] },
    "E-PAYLOAD",
  ],
  ["root.owner 与 tree.owner 不一致", payloadOf([{ ...validTree, owner: "ideas" }]), "E-PAYLOAD"],
  [
    "槽位形状不合法",
    payloadOf([{ ...validTree, root: slot({ id: "x.root", owner: "x", kind: "bad" }) }]),
    "E-PAYLOAD",
  ],
  [
    "单棵树内重复 id",
    payloadOf([
      {
        ...validTree,
        root: slot({
          id: "x.root",
          owner: "x",
          children: [slot({ id: "x.child", owner: "x" }), slot({ id: "x.child", owner: "x" })],
        }),
      },
    ]),
    "E-ID-DUPLICATE",
  ],
  [
    "跨树重复 id",
    payloadOf([
      { ...validTree, root: slot({ id: "dup", owner: "x" }) },
      { ...validTree, owner: "y", root: slot({ id: "dup", owner: "y" }) },
    ]),
    "E-ID-DUPLICATE",
  ],
];

describe("parseLocalTrees：坏 payload 返诊断不抛", () => {
  it.each(invalidPayloads)("%s", (_name, value, code) => {
    expect(codesOf(value)).toContain(code);
  });

  it("重复 id 的诊断带 id 现场", () => {
    const result = parseLocalTrees(
      payloadOf([
        { ...validTree, root: slot({ id: "dup", owner: "x" }) },
        { ...validTree, owner: "y", root: slot({ id: "dup", owner: "y" }) },
      ]),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0]?.message).toContain("重复 id: dup");
      expect(result.diagnostics[0]?.path).toContain("$.trees[1]");
    }
  });

  it("跨树重复 id 不会因为树内容不同而被去重掉", () => {
    expect(
      codesOf(
        payloadOf([
          { ...validTree, root: slot({ id: "dup", owner: "x" }) },
          { ...validTree, owner: "y", root: slot({ id: "dup", owner: "y", props: { v: 1 } }) },
        ]),
      ),
    ).toContain("E-ID-DUPLICATE");
  });
});

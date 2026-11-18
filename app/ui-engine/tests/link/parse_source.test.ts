import { describe, expect, it } from "vitest";
import { parseSourcePush } from "../../src/link/parse";

function tree(owner = "runtime.clock"): Record<string, unknown> {
  return {
    owner,
    mountAt: "dendro.window.nav",
    order: 10,
    seq: 0,
    root: {
      id: owner,
      kind: "dendro:text",
      owner,
      props: { text: "12:00" },
      children: [],
    },
  };
}

describe("parseSourcePush：运行后来源推送", () => {
  it("接受局部树，removed 缺省为空", () => {
    const result = parseSourcePush({ kind: "source", trees: [tree()] });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.push.trees.map((item) => item.owner)).toEqual(["runtime.clock"]);
      expect(result.push.removed).toEqual([]);
    }
  });

  it("接受只撤来源的负载", () => {
    const result = parseSourcePush({ kind: "source", trees: [], removed: ["runtime.clock"] });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.push.trees).toEqual([]);
      expect(result.push.removed).toEqual(["runtime.clock"]);
    }
  });

  it("kind 不对 / trees 非法 / removed 非法都拒绝", () => {
    const wrongKind = parseSourcePush({ kind: "view", trees: [tree()] });
    const badTrees = parseSourcePush({ kind: "source", trees: "nope" });
    const badRemoved = parseSourcePush({ kind: "source", trees: [], removed: "runtime.clock" });
    const emptyOwner = parseSourcePush({ kind: "source", trees: [], removed: [""] });

    expect(wrongKind.ok).toBe(false);
    expect(badTrees.ok).toBe(false);
    expect(badRemoved.ok).toBe(false);
    if (emptyOwner.ok) {
      throw new Error("空 owner 应拒绝");
    }
    expect(emptyOwner.diagnostics.map((item) => item.code)).toEqual(["E-PAYLOAD"]);
  });

  it("局部树形状错误透传 local-trees 诊断", () => {
    const broken = tree();
    broken.root = { id: "x" };
    const result = parseSourcePush({ kind: "source", trees: [broken] });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.map((item) => item.code)).toContain("E-PAYLOAD");
    }
  });
});

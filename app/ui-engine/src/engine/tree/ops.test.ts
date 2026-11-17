import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseOps } from "./ops";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(HERE, "../../../../sdk/tests/fixtures/tree-ops.json");

function fixture(): Record<string, unknown> {
  return JSON.parse(readFileSync(FIXTURE, "utf8")) as Record<string, unknown>;
}

function codesOf(value: unknown): Array<[string, string]> {
  const result = parseOps(value);
  if (result.ok) {
    throw new Error("期望解析失败，实际成功");
  }
  return result.diagnostics.map((diagnostic) => [diagnostic.path, diagnostic.code]);
}

describe("parseOps：共享 fixture", () => {
  it("解析 fixture：五个 op、版本与 seq 都在", () => {
    const result = parseOps(fixture());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.batch.kind).toBe("ops");
    expect(result.batch.base).toBe(7);
    expect(result.batch.document).toBe(8);
    expect(result.batch.seq).toBe(42);
    expect(result.batch.ops.map((op) => op.op)).toEqual([
      "setProps",
      "mount",
      "unmount",
      "replace",
      "data",
    ]);
    const mount = result.batch.ops[1];
    expect(mount?.op === "mount" ? mount.node.id : undefined).toBe("9f0a1b2c3d4e5f60");
    const data = result.batch.ops[4];
    expect(data?.op === "data" ? data.items?.length : undefined).toBe(1);
  });

  it("空 ops 合法", () => {
    const result = parseOps({ kind: "ops", document: 2, base: 1, seq: 0, ops: [] });

    expect(result.ok).toBe(true);
  });
});

describe("parseOps：形状诊断", () => {
  it("document 必须等于 base + 1", () => {
    const value = { ...fixture(), document: 9 };

    expect(codesOf(value)).toEqual([["/document", "E-PAYLOAD"]]);
  });

  it("kind 不对", () => {
    expect(codesOf({ ...fixture(), kind: "view" })).toEqual([["/kind", "E-PAYLOAD"]]);
  });

  it("未知 op", () => {
    const value = { ...fixture(), ops: [{ op: "move", id: "1111111111111111" }] };

    expect(codesOf(value)).toEqual([["/ops/0/op", "E-PAYLOAD"]]);
  });

  it("id 不是 16 位十六进制", () => {
    const value = { ...fixture(), ops: [{ op: "unmount", id: "ideas.feed" }] };

    expect(codesOf(value)).toEqual([["/ops/0/id", "E-PAYLOAD"]]);
  });

  it("节点形状不合法：路径落到 ops[i]/node", () => {
    const value = fixture();
    const ops = value.ops as Array<Record<string, unknown>>;
    const mount = ops[1] as { node: Record<string, unknown> };
    delete mount.node.layout;

    const [first] = codesOf(value);
    expect(first?.[0].startsWith("/ops/1/node")).toBe(true);
    expect(first?.[1]).toBe("E-PAYLOAD");
  });

  it("data 必须且只能有一个载荷", () => {
    const none = { ...fixture(), ops: [{ op: "data", source: "ideas.feed", revision: 1 }] };
    expect(codesOf(none)).toEqual([["/ops/0", "E-PAYLOAD"]]);

    const two = {
      ...fixture(),
      ops: [{ op: "data", source: "ideas.feed", revision: 1, value: 1, items: [] }],
    };
    expect(codesOf(two)).toEqual([["/ops/0", "E-PAYLOAD"]]);
  });

  it("多个错误的诊断按 path 排序", () => {
    expect(codesOf({ kind: "view", document: 9, base: 0, seq: -1, ops: [] })).toEqual([
      ["/base", "E-PAYLOAD"],
      ["/document", "E-PAYLOAD"],
      ["/kind", "E-PAYLOAD"],
      ["/seq", "E-PAYLOAD"],
    ]);
  });

  it("payload 不是对象", () => {
    expect(codesOf("ops")).toEqual([["", "E-PAYLOAD"]]);
  });
});

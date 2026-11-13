import { describe, expect, it } from "vitest";
import { applySnapshotUpdate } from "./patch";
import type { Node } from "../../renderer/types";
import type { Snapshot } from "../types";

function node(type: string, props: Record<string, unknown> = {}, children: Node[] = []): Node {
  return { type, props, children };
}

function snapshot(): Snapshot {
  return {
    pages: [{ name: "main", label: "首页" }],
    page: "main",
    meta: "2 条",
    version: 3,
    content: node("column", {}, [node("text", { text: "甲" }), node("text", { text: "乙" })]),
  };
}

function patched(result: ReturnType<typeof applySnapshotUpdate>): Snapshot {
  if (!result.ok) {
    throw new Error(`补丁被拒: ${result.reason}`);
  }
  return result.snapshot;
}

describe("applySnapshotUpdate：补丁", () => {
  it("set 改一个字段：版本更新，没碰到的子树还是原对象", () => {
    const before = snapshot();

    const after = patched(
      applySnapshotUpdate(before, {
        page: "main",
        version: 4,
        base: 3,
        ops: [{ op: "set", path: ["content", "children", 1, "props", "text"], value: "乙改" }],
      }),
    );

    expect(after.version).toBe(4);
    expect(after.content.children[1]?.props.text).toBe("乙改");
    expect(after.content.children[0]).toBe(before.content.children[0]);
    // 输入没被就地改掉
    expect(before.content.children[1]?.props.text).toBe("乙");
  });

  it("insert 插一条：位置对上，原来的节点没变引用", () => {
    const before = snapshot();

    const after = patched(
      applySnapshotUpdate(before, {
        page: "main",
        version: 4,
        base: 3,
        ops: [
          {
            op: "insert",
            path: ["content", "children"],
            index: 1,
            value: node("text", { text: "新" }),
          },
        ],
      }),
    );

    expect(after.content.children.map((child) => child.props.text)).toEqual(["甲", "新", "乙"]);
    expect(after.content.children[0]).toBe(before.content.children[0]);
    expect(after.content.children[2]).toBe(before.content.children[1]);
  });

  it("remove 删一条：后面的节点仍是原对象", () => {
    const before = snapshot();

    const after = patched(
      applySnapshotUpdate(before, {
        page: "main",
        version: 4,
        base: 3,
        ops: [{ op: "remove", path: ["content", "children"], index: 0 }],
      }),
    );

    expect(after.content.children.map((child) => child.props.text)).toEqual(["乙"]);
    expect(after.content.children[0]).toBe(before.content.children[1]);
  });

  it("set 可以往 props 里加一个新字段（协议里没有删字段的 op，加是允许的）", () => {
    const before = snapshot();

    const after = patched(
      applySnapshotUpdate(before, {
        page: "main",
        version: 4,
        base: 3,
        ops: [{ op: "set", path: ["content", "children", 0, "props", "kind"], value: "title" }],
      }),
    );

    expect(after.content.children[0]?.props).toEqual({ text: "甲", kind: "title" });
  });

  it("页面不是当前页就拒：调用方应该忽略这条", () => {
    const result = applySnapshotUpdate(snapshot(), {
      page: "ideas",
      version: 4,
      base: 3,
      ops: [{ op: "remove", path: ["content", "children"], index: 0 }],
    });

    expect(result).toEqual({ ok: false, reason: "page" });
  });

  it("base 对不上就拒：调用方应该重新要全量", () => {
    const result = applySnapshotUpdate(snapshot(), {
      page: "main",
      version: 5,
      base: 99,
      ops: [{ op: "remove", path: ["content", "children"], index: 0 }],
    });

    expect(result).toEqual({ ok: false, reason: "version" });
  });

  it("不认识的 op 一律拒，不做部分应用", () => {
    for (const op of [
      { op: "move", path: ["content", "children"], index: 0 },
      { op: "set", path: ["content", "children", 0, "props", "text"] },
      { op: "insert", path: ["content", "children"], index: 0, value: "不是节点" },
    ]) {
      const result = applySnapshotUpdate(snapshot(), {
        page: "main",
        version: 4,
        base: 3,
        ops: [op],
      });
      expect(result).toEqual({ ok: false, reason: "malformed" });
    }
  });

  it("路径走不通（中间 key 不在 / 下标越界）就拒", () => {
    for (const op of [
      { op: "set", path: ["content", "children", 0, "props", "nope", "x"], value: 1 },
      { op: "set", path: ["content", "children", 9, "props", "text"], value: "x" },
      { op: "remove", path: ["content", "children"], index: 2 },
      { op: "insert", path: ["content", "children"], index: 9, value: node("text") },
      { op: "set", path: [], value: 1 },
    ]) {
      const result = applySnapshotUpdate(snapshot(), {
        page: "main",
        version: 4,
        base: 3,
        ops: [op],
      });
      expect(result).toEqual({ ok: false, reason: "malformed" });
    }
  });

  it("载荷形状不对就拒：没有 content 也没有 ops、ops 不是数组、缺 base / version", () => {
    const before = snapshot();
    for (const payload of [
      {},
      { page: "main", version: 4 },
      { page: "main", version: 4, base: 3, ops: {} },
      { page: "main", version: 4, ops: [] },
      { page: "main", base: 3, ops: [] },
      "not-an-object",
    ]) {
      expect(applySnapshotUpdate(before, payload)).toEqual({ ok: false, reason: "malformed" });
    }
  });
});

describe("applySnapshotUpdate：全量", () => {
  it("有 content 就整棵替换，版本取载荷里的", () => {
    const before = snapshot();
    const content = node("text", { text: "全量" });

    const after = patched(
      applySnapshotUpdate(before, {
        pages: [
          { name: "main", label: "首页" },
          { name: "ideas", label: "灵感", icon: "ideas", count: 2 },
        ],
        page: "main",
        meta: "1 条",
        content,
        version: 9,
      }),
    );

    expect(after.version).toBe(9);
    expect(after.content).toBe(content);
    expect(after.meta).toBe("1 条");
    expect(after.pages).toHaveLength(2);
  });

  it("全量的页对不上算换页：调用方应该忽略", () => {
    const result = applySnapshotUpdate(snapshot(), {
      pages: [{ name: "ideas", label: "灵感" }],
      page: "ideas",
      meta: "",
      content: node("text", { text: "别的页" }),
      version: 9,
    });

    expect(result).toEqual({ ok: false, reason: "page" });
  });

  it("全量缺版本或内容不是节点就算坏载荷", () => {
    const before = snapshot();
    for (const payload of [
      { pages: [], page: "main", meta: "", content: node("text") },
      { pages: [], page: "main", meta: "", content: "不是节点", version: 9 },
      { pages: [], page: "main", meta: 3, content: node("text"), version: 9 },
    ]) {
      expect(applySnapshotUpdate(before, payload)).toEqual({ ok: false, reason: "malformed" });
    }
  });
});

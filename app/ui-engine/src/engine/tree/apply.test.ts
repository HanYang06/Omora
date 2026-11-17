import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Document, Node } from "../../contract/tree_generated";
import { applyOps } from "./apply";

const HERE = dirname(fileURLToPath(import.meta.url));
const TREE = resolve(HERE, "../../../../../schema/tree");
const OPS = resolve(HERE, "../../../../sdk/tests/fixtures/tree-ops.json");

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

function baseDocument(): Document {
  const document = readJson(resolve(TREE, "example/tree.root.json")) as unknown as Document;
  return { ...document, version: 7 };
}

function fixtureOps(): unknown[] {
  return (readJson(OPS).ops as unknown[]).slice(0, 4);
}

function batch(ops: unknown[], over: Record<string, unknown> = {}): Record<string, unknown> {
  return { kind: "ops", document: 8, base: 7, seq: 42, ops, ...over };
}

function find(node: Node, id: string): Node | undefined {
  if (node.id === id) {
    return node;
  }
  for (const child of node.layout) {
    const found = find(child, id);
    if (found !== undefined) {
      return found;
    }
  }
  for (const template of Object.values(node.collection?.templates ?? {})) {
    const found = find(template, id);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

function codes(result: ReturnType<typeof applyOps>): string[] {
  if (result.ok) {
    throw new Error("期望失败，实际成功");
  }
  return result.diagnostics.map((diagnostic) => diagnostic.code);
}

describe("applyOps：成功路径", () => {
  it("setProps / mount / unmount / replace 一次应用，版本推进", () => {
    const base = baseDocument();
    const result = applyOps(base, batch(fixtureOps()));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.version).toBe(8);
    expect(result.changed).toEqual(["1c2d3e4f5a6b7c8d", "9f0a1b2c3d4e5f60", "0b1c2d3e4f5a6b7c"]);
    const replaced = find(result.document.root, "1c2d3e4f5a6b7c8d");
    expect(replaced?.settings).toEqual({ text: "再搜" });
    expect(find(result.document.root, "0b1c2d3e4f5a6b7c")).toBeUndefined();
    const mounted = find(result.document.root, "9f0a1b2c3d4e5f60");
    expect(mounted?.settings).toEqual({ title: "新条目" });
    const feed = find(result.document.root, "7e8f9a0b1c2d3e4f");
    expect(feed?.layout.map((child) => child.order)).toEqual([10, 30]);
  });

  it("只复制被触碰节点的祖先：未触碰的兄弟保持原引用", () => {
    const base = baseDocument();
    const setProps = { op: "setProps", id: "1c2d3e4f5a6b7c8d", props: { text: "新" } };

    const result = applyOps(base, batch([setProps]));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.root).not.toBe(base.root);
    // root.layout[1] 是 main 子树，跟 nav 下的按钮无关，整棵复用。
    expect(result.document.root.layout[1]).toBe(base.root.layout[1]);
    const original = find(base.root, "1c2d3e4f5a6b7c8d");
    expect(original?.settings).not.toEqual({ text: "新" });
  });
});

describe("applyOps：版本与原子性", () => {
  it("base 与当前版本不一致 -> E-VERSION", () => {
    const result = applyOps(baseDocument(), batch([], { base: 6, document: 7 }));

    expect(codes(result)).toEqual(["E-VERSION"]);
  });

  it("任一 op 失败整批不生效，原文档不变", () => {
    const base = baseDocument();
    const snapshot = structuredClone(base);
    const ops = [
      { op: "setProps", id: "1c2d3e4f5a6b7c8d", props: { text: "新" } },
      { op: "unmount", id: "ffffffffffffffff" },
    ];

    const result = applyOps(base, batch(ops));

    expect(codes(result)).toEqual(["E-TARGET-MISSING"]);
    expect(base).toEqual(snapshot);
  });

  it("data op 还没接：整批失败，不应用一半", () => {
    const base = baseDocument();
    const result = applyOps(
      base,
      batch([{ op: "data", source: "ideas.feed", revision: 1, value: 1 }]),
    );

    expect(codes(result)).toEqual(["E-PAYLOAD"]);
    expect(base.version).toBe(7);
  });
});

describe("applyOps：结构语义", () => {
  it("mount 的 chain 必须由目标父链推出", () => {
    const ops = structuredClone(fixtureOps());
    const mount = ops[1] as { node: Node };
    mount.node.chain = "a1b2c3d4e5f6a7b8.ffffffffffffffff";

    const result = applyOps(baseDocument(), batch(ops));

    expect(codes(result)).toEqual(["E-PAYLOAD"]);
    expect(result.ok ? "" : result.diagnostics[0]?.message).toContain("chain");
  });

  it("mount 的同级 order 不能重复", () => {
    const ops = structuredClone(fixtureOps());
    const mount = ops[1] as { node: Node };
    mount.node.order = 10;

    const result = applyOps(baseDocument(), batch(ops));

    expect(codes(result)).toEqual(["E-PAYLOAD"]);
    expect(result.ok ? "" : result.diagnostics[0]?.message).toContain("order");
  });

  it("mount / replace 的 id 不能和现有节点撞", () => {
    const ops = structuredClone(fixtureOps());
    const mount = ops[1] as { node: Node };
    mount.node.id = "0b1c2d3e4f5a6b7c";
    mount.node.chain =
      "a1b2c3d4e5f6a7b8.3a4b5c6d7e8f9a0b.4b5c6d7e8f9a0b1c.7e8f9a0b1c2d3e4f.0b1c2d3e4f5a6b7c";

    const result = applyOps(baseDocument(), batch([ops[1]]));

    expect(codes(result)).toEqual(["E-PAYLOAD"]);
    expect(result.ok ? "" : result.diagnostics[0]?.message).toContain("id 已存在");
  });

  it("根不能 unmount / replace", () => {
    expect(
      codes(applyOps(baseDocument(), batch([{ op: "unmount", id: "a1b2c3d4e5f6a7b8" }]))),
    ).toEqual(["E-PAYLOAD"]);
    const replace = {
      op: "replace",
      id: "a1b2c3d4e5f6a7b8",
      node: {
        id: "a1b2c3d4e5f6a7b8",
        chain: "a1b2c3d4e5f6a7b8",
        kind: "app",
        order: 0,
        layout: [],
        settings: {},
        bind: {},
        on: {},
        emit: {},
      },
    };
    expect(codes(applyOps(baseDocument(), batch([replace])))).toEqual(["E-PAYLOAD"]);
  });

  it("模板节点可以 setProps，但不能做结构操作", () => {
    const base = baseDocument();
    const feed = find(base.root, "7e8f9a0b1c2d3e4f");
    if (feed === undefined) throw new Error("fixture 少了 feed");
    const template: Node = {
      id: "1111111111111111",
      chain: feed.chain + ".1111111111111111",
      kind: "card",
      order: 10,
      layout: [],
      settings: { title: "模板" },
      bind: {},
      on: {},
      emit: {},
    };
    feed.collection = { source: "ideas.feed", key: "id", templates: { item: template } };

    const setProps = applyOps(
      base,
      batch([{ op: "setProps", id: "1111111111111111", props: { title: "改模板" } }]),
    );
    expect(setProps.ok).toBe(true);
    if (setProps.ok) {
      expect(find(setProps.document.root, "1111111111111111")?.settings).toEqual({
        title: "改模板",
      });
    }

    const mountAChild = applyOps(
      base,
      batch([
        {
          op: "mount",
          parent: "1111111111111111",
          node: {
            id: "2222222222222222",
            chain: "1111111111111111.2222222222222222",
            kind: "text",
            order: 10,
            layout: [],
            settings: {},
            bind: {},
            on: {},
            emit: {},
          },
        },
      ]),
    );
    expect(codes(mountAChild)).toEqual(["E-PAYLOAD"]);
  });

  it("replace 不能改 order", () => {
    const replace = structuredClone((fixtureOps()[3] as { node: Node }).node);
    const op = { op: "replace", id: "1c2d3e4f5a6b7c8d", node: { ...replace, order: 20 } };

    const result = applyOps(baseDocument(), batch([op]));

    expect(codes(result)).toEqual(["E-PAYLOAD"]);
    expect(result.ok ? "" : result.diagnostics[0]?.message).toContain("order");
  });
});

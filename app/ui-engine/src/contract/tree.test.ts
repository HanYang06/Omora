import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateTree, type TreeShape } from "./tree";

// src/contract -> app/ui-engine/src -> app/ui-engine -> app -> 仓库根
const TREE_URL = new URL("../../../../schema/tree/", import.meta.url);

function readJson(relativePath: string): unknown {
  return JSON.parse(
    readFileSync(fileURLToPath(new URL(relativePath, TREE_URL)), "utf8"),
  ) as unknown;
}

interface InvalidCase {
  file: string;
  type: TreeShape;
  scope: "shape" | "semantic";
  code: string;
}

const manifest = JSON.parse(
  readFileSync(fileURLToPath(new URL("invalid/manifest.json", TREE_URL)), "utf8"),
) as InvalidCase[];

const EXAMPLES: ReadonlyArray<readonly [string, TreeShape]> = [
  ["tree.node.json", "node"],
  ["tree.partial.json", "partial"],
  ["tree.root.json", "document"],
];

const shapeCases = manifest.filter((entry) => entry.scope === "shape");
const semanticCases = manifest.filter((entry) => entry.scope === "semantic");

/** 诊断塌缩成 [code, path] 便于断言；path 是 JSON Pointer，根为 ""。 */
function failures(value: unknown, shape: TreeShape): Array<[string, string]> {
  return validateTree(value, shape).map((diagnostic) => [diagnostic.code, diagnostic.path]);
}

function mutableFixture(relativePath: string): Record<string, unknown> {
  return readJson(relativePath) as Record<string, unknown>;
}

describe("树 V1 形状校验：示例", () => {
  it.each(EXAMPLES)("接受示例 %s", (file, shape) => {
    expect(validateTree(readJson("example/" + file), shape)).toEqual([]);
  });

  it("invalid 清单同时覆盖 shape 与 semantic 两层", () => {
    expect(shapeCases.length).toBeGreaterThan(0);
    expect(semanticCases.length).toBeGreaterThan(0);
  });
});

describe("树 V1 形状校验：invalid 清单", () => {
  it.each(shapeCases.map((entry) => [entry.file, entry] as const))(
    "拒绝 %s 并给出清单里的诊断码",
    (_file, entry) => {
      const diagnostics = validateTree(readJson("invalid/" + entry.file), entry.type);

      expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(entry.code);
    },
  );

  it.each(semanticCases.map((entry) => [entry.file, entry] as const))(
    "%s 是语义错误，shape 层仍应接受",
    (_file, entry) => {
      expect(validateTree(readJson("invalid/" + entry.file), entry.type)).toEqual([]);
    },
  );
});

describe("树 V1 形状校验：诊断码映射", () => {
  it("id 不合法 -> E-TREE-ID", () => {
    const node = mutableFixture("example/tree.node.json");
    node.id = "not-an-id";

    expect(failures(node, "node")).toEqual([["E-TREE-ID", "/id"]]);
  });

  it("chain 不合法 -> E-TREE-CHAIN", () => {
    const node = mutableFixture("example/tree.node.json");
    node.chain = "not-a-chain";

    expect(failures(node, "node")).toEqual([["E-TREE-CHAIN", "/chain"]]);
  });

  it("mount.mode 不在枚举里 -> E-TREE-MOUNT", () => {
    const partial = mutableFixture("example/tree.partial.json");
    (partial.mount as Record<string, unknown>).mode = "sideways";

    expect(failures(partial, "partial")).toEqual([["E-TREE-MOUNT", "/mount/mode"]]);
  });

  it("document root.kind 不是 app -> E-TREE-ROOT", () => {
    const document = mutableFixture("example/tree.root.json");
    (document.root as Record<string, unknown>).kind = "column";

    expect(failures(document, "document")).toEqual([["E-TREE-ROOT", "/root/kind"]]);
  });

  it("未知字段 -> E-TREE-PAYLOAD", () => {
    const node = mutableFixture("example/tree.node.json");
    node.extra = true;

    expect(failures(node, "node")).toEqual([["E-TREE-PAYLOAD", ""]]);
  });

  it("字段类型不对 -> E-TREE-PAYLOAD", () => {
    const node = mutableFixture("example/tree.node.json");
    node.order = "1";

    expect(failures(node, "node")).toEqual([["E-TREE-PAYLOAD", "/order"]]);
  });
});

describe("树 V1 形状校验：诊断排序", () => {
  it("多个错误按 instancePath 升序，与 ajv 产出顺序无关", () => {
    const node = mutableFixture("example/tree.node.json");
    node.id = "not-an-id";
    node.chain = "not-a-chain";
    node.extra = true;

    const sorted = failures(node, "node");

    expect(sorted).toEqual([
      ["E-TREE-PAYLOAD", ""],
      ["E-TREE-CHAIN", "/chain"],
      ["E-TREE-ID", "/id"],
    ]);
  });
});

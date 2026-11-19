/**
 * 构建期树组合器的行为测试。
 *
 * 正例直接用一份 schema 的示例：`tree.root.json` 是组合后的权威 document，
 * `tree.partial.json` 是挂进它的局部树。把 root 里的页面子树摘掉当 base，再挂回
 * partial，输出必须逐字段还原 root 示例——这比"字段非空"更能证明组合行为。
 *
 * 形状仍用同一个来源：`contract/tree` 的 `validateTree`（由
 * `schema/tree/tree.schema.json` 生成），正例 / 负例读同一份 `schema/tree`。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateTree } from "../../../src/contract/tree";
import type { Document, Node, Partial as TreePartial } from "../../../src/contract/tree_generated";
import {
  TreeComposeError,
  assertTreeComposes,
  composeTree,
  type TreeComposeDiagnostic,
  type TreeComposeDiagnosticCode,
  type TreeComposeResult,
} from "../../../src/link/tree_compose";

// src/build/tree -> src -> app/ui-engine -> app -> 仓库根
const TREE_URL = new URL("../../../../../schema/tree/", import.meta.url);

const MAIN_ID = "3a4b5c6d7e8f9a0b";
const NAV_ID = "0a1b2c3d4e5f6a7b";
const PAGE_ID = "4b5c6d7e8f9a0b1c";
const LEAF_A_ID = "1111111111111111";
const LEAF_B_ID = "2222222222222222";
const MISSING_A_ID = "ffffffffffffffff";
const MISSING_B_ID = "eeeeeeeeeeeeeeee";

function readFixture(relativePath: string): unknown {
  return JSON.parse(
    readFileSync(fileURLToPath(new URL(relativePath, TREE_URL)), "utf8"),
  ) as unknown;
}

function cloneValue<T>(value: T): T {
  return structuredClone(value);
}

function rootDocument(): Document {
  return cloneValue(readFixture("example/tree.root.json")) as Document;
}

function partialExample(): TreePartial {
  return cloneValue(readFixture("example/tree.partial.json")) as TreePartial;
}

function nodeExample(): Node {
  return cloneValue(readFixture("example/tree.node.json")) as Node;
}

function tryFindNode(node: Node, id: string): Node | undefined {
  if (node.id === id) {
    return node;
  }
  for (const child of node.layout) {
    const found = tryFindNode(child, id);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

function findNode(node: Node, id: string): Node {
  const found = tryFindNode(node, id);
  if (found === undefined) {
    throw new Error("fixture 里没有节点 " + id);
  }
  return found;
}

/** 示例 root 去掉页面子树：模拟"base 尚未挂 ideas 页面"的构建期输入。 */
function baseWithoutPage(): Document {
  const document = rootDocument();
  const parent = findNode(document.root, MAIN_ID);
  parent.layout = parent.layout.filter((child) => child.id !== PAGE_ID);
  return document;
}

/** 换掉一个子树根的身份，并按父 chain 重算整棵子树的 chain（模拟另一个合法 partial）。 */
function reidentify(node: Node, id: string, parentChain: string): void {
  node.id = id;
  node.chain = parentChain + "." + id;
  for (const child of node.layout) {
    reidentify(child, child.id, node.chain);
  }
}

/** 造一个只含单节点的 partial；chain 由调用方给出的父 chain 推出。 */
function leafPartial(options: {
  id: string;
  order: number;
  parent: string;
  parentChain: string;
}): TreePartial {
  const root = nodeExample();
  root.order = options.order;
  reidentify(root, options.id, options.parentChain);
  return {
    schema: "dendro.tree/1",
    source: "test",
    mount: { parent: options.parent, mode: "new" },
    root,
  };
}

type Failure = Extract<TreeComposeResult, { ok: false }>;

function composeDocument(base: Document, partials: readonly TreePartial[]): Document {
  const result = composeTree(base, partials);
  if (!result.ok) {
    throw new Error("期望组合成功，实际诊断：" + JSON.stringify(result.diagnostics));
  }
  return result.document;
}

function failureOf(base: unknown, partials: readonly unknown[]): Failure {
  const result = composeTree(base, partials);
  if (result.ok) {
    throw new Error("期望组合失败，实际成功");
  }
  return result;
}

function pairs(
  diagnostics: readonly TreeComposeDiagnostic[],
): Array<[TreeComposeDiagnosticCode, string]> {
  return diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.path]);
}

/** 给节点挂一个集合模板；模板节点的 chain 由宿主 chain 推出。 */
function templateOn(host: Node, templateId: string): void {
  const template = nodeExample();
  template.id = templateId;
  template.order = 10;
  template.chain = host.chain + "." + templateId;
  host.collection = {
    source: "ideas.feed",
    key: "id",
    templates: { item: template },
  };
}

function thrownBy(action: () => unknown): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }
  throw new Error("期望抛错，实际没有");
}

describe("构建期树组合：成功路径", () => {
  it("把示例 partial 挂回 base 后逐字段还原示例 document", () => {
    const composed = composeDocument(baseWithoutPage(), [partialExample()]);

    expect(composed).toEqual(rootDocument());
    // 输出必须仍然是同一份 tree schema 下的合法 document。
    expect(validateTree(composed, "document")).toEqual([]);
  });

  it("挂载后父节点 layout 按 order 升序，且与 partial 到达顺序无关", () => {
    const base = rootDocument();
    const mainChain = findNode(base.root, MAIN_ID).chain;
    const orderFifth = leafPartial({
      id: LEAF_A_ID,
      order: 5,
      parent: MAIN_ID,
      parentChain: mainChain,
    });
    const orderThirtieth = leafPartial({
      id: LEAF_B_ID,
      order: 30,
      parent: MAIN_ID,
      parentChain: mainChain,
    });

    const forward = composeDocument(base, [orderFifth, orderThirtieth]);
    const reversed = composeDocument(base, [orderThirtieth, orderFifth]);

    expect(forward).toEqual(reversed);
    expect(findNode(forward.root, MAIN_ID).layout.map((child) => child.order)).toEqual([5, 10, 30]);
    expect(findNode(forward.root, MAIN_ID).layout.map((child) => child.id)).toEqual([
      LEAF_A_ID,
      PAGE_ID,
      LEAF_B_ID,
    ]);
  });

  it("partial 可以挂到更早挂上的 partial 引入的节点下", () => {
    const pagePartial = partialExample();
    const leaf = leafPartial({
      id: LEAF_A_ID,
      order: 5,
      parent: PAGE_ID,
      parentChain: pagePartial.root.chain,
    });

    const composed = composeDocument(baseWithoutPage(), [pagePartial, leaf]);

    const page = findNode(composed.root, PAGE_ID);
    expect(page.layout.map((child) => child.id)).toContain(LEAF_A_ID);
    expect(page.layout[0]?.id).toBe(LEAF_A_ID);
    expect(validateTree(composed, "document")).toEqual([]);
  });

  it("没有 partial 时返回 base 的副本，不改入参", () => {
    const base = baseWithoutPage();
    const snapshot = cloneValue(base);

    const composed = composeDocument(base, []);

    expect(composed).toEqual(snapshot);
    expect(composed).not.toBe(base);
    expect(composed.root).not.toBe(base.root);
    expect(base).toEqual(snapshot);
  });
});

describe("构建期树组合：挂载语义", () => {
  it("重复 id / chain -> E-COLLISION，不产出 document", () => {
    // 示例 root 里已经有 partial 的整棵子树，再挂一次全部身份都撞。
    const failure = failureOf(rootDocument(), [partialExample()]);

    expect("document" in failure).toBe(false);
    expect(failure.diagnostics.length).toBeGreaterThan(0);
    expect(failure.diagnostics.every((diagnostic) => diagnostic.code === "E-COLLISION")).toBe(true);
    const paths = failure.diagnostics.map((diagnostic) => diagnostic.path);
    expect(paths).toContain("partials[0]/root/id");
    // 子树里的 id 也逐个查：partial 的后代同样不能和现有节点撞。
    expect(paths).toContain("partials[0]/root/layout[0]/id");
  });

  it("partial 子树里的 chain 撞到现有节点 -> E-COLLISION", () => {
    const base = rootDocument();
    const mainChain = findNode(base.root, MAIN_ID).chain;
    const takenChain = findNode(base.root, PAGE_ID).chain;
    const root = leafPartial({
      id: LEAF_A_ID,
      order: 30,
      parent: MAIN_ID,
      parentChain: mainChain,
    }).root;
    // 子树内部的 chain 一致性由 Python 解析器守；这里故意喂一条"形状合法但已被占用"的链，
    // 证明组合器的跨树身份检查不是只查根节点。
    const child = nodeExample();
    child.id = LEAF_B_ID;
    child.order = 10;
    child.chain = takenChain;
    root.layout = [child];

    const failure = failureOf(base, [
      {
        schema: "dendro.tree/1",
        source: "test",
        mount: { parent: MAIN_ID, mode: "new" },
        root,
      },
    ]);

    expect(pairs(failure.diagnostics)).toEqual([
      ["E-COLLISION", "partials[0]/root/layout[0]/chain"],
    ]);
  });

  it("同父同 order -> E-COLLISION", () => {
    const base = rootDocument();
    const mainChain = findNode(base.root, MAIN_ID).chain;
    const collision = leafPartial({
      id: LEAF_A_ID,
      order: 10,
      parent: MAIN_ID,
      parentChain: mainChain,
    });

    const failure = failureOf(base, [collision]);

    expect(pairs(failure.diagnostics)).toEqual([["E-COLLISION", "partials[0]/root/order"]]);
  });

  it("父不存在 -> E-PARENT-MISSING", () => {
    const base = baseWithoutPage();
    const orphan = leafPartial({
      id: LEAF_A_ID,
      order: 10,
      parent: MISSING_A_ID,
      parentChain: findNode(base.root, MAIN_ID).chain,
    });

    const failure = failureOf(base, [orphan]);

    expect(pairs(failure.diagnostics)).toEqual([["E-PARENT-MISSING", "partials[0]/mount/parent"]]);
  });

  it("错链接（root.chain 不是父 chain + id）-> E-TREE-CHAIN", () => {
    const base = baseWithoutPage();
    const expectedChain = findNode(base.root, MAIN_ID).chain + "." + LEAF_A_ID;
    const wrongLink = leafPartial({
      id: LEAF_A_ID,
      order: 10,
      parent: MAIN_ID,
      parentChain: findNode(base.root, NAV_ID).chain,
    });

    const failure = failureOf(base, [wrongLink]);

    expect(pairs(failure.diagnostics)).toEqual([["E-TREE-CHAIN", "partials[0]/root/chain"]]);
    expect(
      failure.diagnostics.some((diagnostic) => diagnostic.message.includes(expectedChain)),
    ).toBe(true);
  });

  it("overlay 形状合法但 V1 未实现 -> E-MOUNT-UNSUPPORTED", () => {
    const partial = partialExample();
    partial.mount.mode = "overlay";

    const failure = failureOf(baseWithoutPage(), [partial]);

    expect(pairs(failure.diagnostics)).toEqual([["E-MOUNT-UNSUPPORTED", "partials[0]/mount/mode"]]);
  });

  it("shape 失败先报，且不再跑挂载语义", () => {
    const base = rootDocument();
    base.root.kind = "column";
    const invalidPartial = readFixture("invalid/partial-mode.json");

    const failure = failureOf(base, [invalidPartial]);

    expect(pairs(failure.diagnostics)).toEqual([
      ["E-TREE-ROOT", "base/root/kind"],
      ["E-TREE-MOUNT", "partials[0]/mount/mode"],
    ]);
  });

  it("失败是原子的：不改入参、不返回半成品", () => {
    const base = baseWithoutPage();
    const baseSnapshot = cloneValue(base);
    const mounted = partialExample();
    const colliding = leafPartial({
      id: PAGE_ID,
      order: 30,
      parent: MAIN_ID,
      parentChain: findNode(base.root, MAIN_ID).chain,
    });
    const mountedSnapshot = cloneValue(mounted);
    const collidingSnapshot = cloneValue(colliding);

    // 第一个 partial 会先挂上；第二个撞它的 root id。失败后 base / partials 都不能变。
    const failure = failureOf(base, [mounted, colliding]);

    expect(pairs(failure.diagnostics)).toEqual([["E-COLLISION", "partials[1]/root/id"]]);
    expect("document" in failure).toBe(false);
    expect(base).toEqual(baseSnapshot);
    expect(mounted).toEqual(mountedSnapshot);
    expect(colliding).toEqual(collidingSnapshot);
  });

  it("同一输入重复组合得到完全相同的诊断（含排序）", () => {
    const base = baseWithoutPage();
    const mainChain = findNode(base.root, MAIN_ID).chain;
    const orphanA = leafPartial({
      id: LEAF_A_ID,
      order: 10,
      parent: MISSING_A_ID,
      parentChain: mainChain,
    });
    const orphanB = leafPartial({
      id: LEAF_B_ID,
      order: 20,
      parent: MISSING_B_ID,
      parentChain: mainChain,
    });

    const first = failureOf(base, [orphanA, orphanB]).diagnostics;
    const again = failureOf(base, [orphanA, orphanB]).diagnostics;

    expect(again).toEqual(first);
    expect(pairs(first)).toEqual([
      ["E-PARENT-MISSING", "partials[0]/mount/parent"],
      ["E-PARENT-MISSING", "partials[1]/mount/parent"],
    ]);
  });
});

describe("构建期树组合：collection 模板", () => {
  it("模板里的 id 撞到已组合树 -> E-COLLISION", () => {
    const base = rootDocument();
    const host = leafPartial({
      id: LEAF_A_ID,
      order: 30,
      parent: MAIN_ID,
      parentChain: findNode(base.root, MAIN_ID).chain,
    });
    templateOn(host.root, PAGE_ID);

    const failure = failureOf(base, [host]);

    expect(pairs(failure.diagnostics)).toEqual([
      ["E-COLLISION", "partials[0]/root/collection/templates/item/id"],
    ]);
  });

  it("mount.parent 指向模板节点 -> E-PARENT-MISSING（模板不挂载）", () => {
    const base = baseWithoutPage();
    const host = leafPartial({
      id: LEAF_A_ID,
      order: 30,
      parent: MAIN_ID,
      parentChain: findNode(base.root, MAIN_ID).chain,
    });
    templateOn(host.root, LEAF_B_ID);
    const child = leafPartial({
      id: "3333333333333333",
      order: 10,
      parent: LEAF_B_ID,
      parentChain: host.root.chain,
    });

    const failure = failureOf(base, [host, child]);

    expect(pairs(failure.diagnostics)).toEqual([["E-PARENT-MISSING", "partials[1]/mount/parent"]]);
    expect(failure.diagnostics[0]?.message).toContain("模板不可挂载");
  });
});

describe("构建期树组合：门禁入口", () => {
  it("成功时直接返回 document", () => {
    const composed = assertTreeComposes(baseWithoutPage(), [partialExample()]);

    expect(composed).toEqual(rootDocument());
  });

  it("失败时抛 TreeComposeError，并带上同一组诊断", () => {
    const base = rootDocument();
    const collision = leafPartial({
      id: LEAF_A_ID,
      order: 10,
      parent: MAIN_ID,
      parentChain: findNode(base.root, MAIN_ID).chain,
    });
    const failure = failureOf(base, [collision]);

    const thrown = thrownBy(() => assertTreeComposes(base, [collision]));

    expect(thrown).toBeInstanceOf(TreeComposeError);
    expect((thrown as TreeComposeError).diagnostics).toEqual(failure.diagnostics);
  });
});

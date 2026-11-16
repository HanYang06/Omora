import { describe, expect, it } from "vitest";
import rootTreeJson from "../../../sdk/omora/sdk/root-tree.json";
import { DocumentError } from "../contract/document";
import type { SlotNode } from "../contract/document";
import { WINDOW_ANCHORS, WINDOW_SCAFFOLD, parseWindowScaffold } from "./scaffold";

interface RawSlot {
  id: string;
  kind: string;
  owner: string;
  props: Record<string, unknown>;
  layout: Record<string, unknown>;
  children: RawSlot[];
}

interface RawRootTree {
  schema: string;
  version: number;
  root: RawSlot;
  anchors: Record<string, string>;
}

function rawTree(): RawRootTree {
  return structuredClone(rootTreeJson);
}

function idsOf(node: SlotNode, found: string[] = []): string[] {
  found.push(node.id);
  for (const child of node.children) {
    idsOf(child, found);
  }
  return found;
}

describe("WINDOW_SCAFFOLD", () => {
  it("加载窗口根：row 根、nav 56px、page 单占位", () => {
    expect(WINDOW_SCAFFOLD.id).toBe("dendro.window");
    expect(WINDOW_SCAFFOLD.kind).toBe("dendro:window");
    expect(WINDOW_SCAFFOLD.layout?.flow).toBe("row");
    expect(WINDOW_SCAFFOLD.children.map((child) => child.id)).toEqual([
      "dendro.window.nav",
      "dendro.window.page",
    ]);
  });

  it("锚点全部指向骨架里真实存在的 Slot", () => {
    const ids = idsOf(WINDOW_SCAFFOLD);

    expect(WINDOW_ANCHORS.window).toBe(WINDOW_SCAFFOLD.id);
    expect(ids).toContain(WINDOW_ANCHORS.nav);
    expect(ids).toContain(WINDOW_ANCHORS.page);
    expect(WINDOW_SCAFFOLD.children.map((child) => child.id)).toEqual([
      WINDOW_ANCHORS.nav,
      WINDOW_ANCHORS.page,
    ]);
  });

  it("深冻结：根、子节点、布局与锚点都改不动", () => {
    const nav = WINDOW_SCAFFOLD.children[0];

    expect(Object.isFrozen(WINDOW_SCAFFOLD)).toBe(true);
    expect(Object.isFrozen(WINDOW_SCAFFOLD.children)).toBe(true);
    expect(Object.isFrozen(nav)).toBe(true);
    expect(Object.isFrozen(nav?.children)).toBe(true);
    expect(Object.isFrozen(nav?.layout)).toBe(true);
    expect(Object.isFrozen(WINDOW_ANCHORS)).toBe(true);
    expect(() => {
      WINDOW_SCAFFOLD.id = "changed";
    }).toThrow(TypeError);
  });
});

describe("parseWindowScaffold", () => {
  it("同一个根树文件解析出的骨架与导出的 WINDOW_SCAFFOLD 一致", () => {
    const parsed = parseWindowScaffold(rootTreeJson);

    expect(parsed.root).toEqual(WINDOW_SCAFFOLD);
    expect(parsed.anchors).toEqual(WINDOW_ANCHORS);
  });

  it("schema 不是 dendro.ui/1 时拒绝", () => {
    const tree = rawTree();
    tree.schema = "dendro.ui/2";

    expect(() => parseWindowScaffold(tree)).toThrow(DocumentError);
  });

  it("根节点形状不是 Slot 时拒绝", () => {
    const tree = rawTree();
    const root = tree.root as Partial<RawSlot>;
    delete root.children;

    expect(() => parseWindowScaffold(tree)).toThrow(DocumentError);
  });

  it("根 kind 不是 dendro:window 时拒绝", () => {
    const tree = rawTree();
    tree.root.kind = "dendro:slot";

    expect(() => parseWindowScaffold(tree)).toThrow(/root\.kind 必须是 dendro:window/);
  });

  it("重复 id 时拒绝", () => {
    const tree = rawTree();
    const nav = tree.root.children[0];
    const page = tree.root.children[1];
    if (nav === undefined || page === undefined) {
      throw new Error("根树结构文件缺少 nav / page 两个子 Slot");
    }
    page.id = nav.id;

    expect(() => parseWindowScaffold(tree)).toThrow(DocumentError);
  });

  it("锚点指向不存在的 id 时拒绝", () => {
    const tree = rawTree();
    tree.anchors.page = "dendro.window.ghost";

    expect(() => parseWindowScaffold(tree)).toThrow(/指向不存在的 id/);
  });

  it("缺少必需锚点时拒绝", () => {
    const tree = rawTree();
    delete tree.anchors.nav;

    expect(() => parseWindowScaffold(tree)).toThrow(/缺少锚点: nav/);
  });

  it("window 锚点不指向根时拒绝", () => {
    const tree = rawTree();
    tree.anchors.window = "dendro.window.nav";

    expect(() => parseWindowScaffold(tree)).toThrow(/必须是根 id/);
  });

  it("不是对象时拒绝", () => {
    expect(() => parseWindowScaffold([])).toThrow(/必须是对象/);
  });
});

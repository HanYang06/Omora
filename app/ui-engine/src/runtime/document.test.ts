import { describe, expect, it } from "vitest";
import type { SlotNode } from "../contract/document";
import { DocumentIndex, createState } from "./document";
import { node } from "./test_fixtures";

/** 一棵把「live 子节点、模板子树、两种 source 消费」都覆盖到的根树。 */
function tree(): SlotNode {
  return node({
    id: "dendro.window",
    kind: "dendro:window",
    owner: "ideas",
    layout: { flow: "column", capacity: "many" },
    in: [{ source: "net.status" }],
    children: [
      node({
        id: "ideas.feed",
        owner: "ideas",
        layout: { flow: "column", capacity: "many" },
        in: [{ source: "ideas.feed" }, { source: "ideas.feed" }],
        collection: {
          source: "ideas.feed",
          key: "id",
          select: "template",
          templates: {
            item: node({
              id: "ideas.feed#tpl",
              children: [node({ id: "ideas.feed#tpl.title", in: [{ source: "ideas.row" }] })],
            }),
          },
        },
        children: [node({ id: "ideas.feed#42" }), node({ id: "ideas.feed#7" })],
      }),
      node({ id: "ideas.search", kind: "dendro:search", in: [{ source: "net.status" }] }),
    ],
  });
}

function indexOf(): DocumentIndex {
  return DocumentIndex.build(tree());
}

describe("createState：根树校验与接管", () => {
  it("合法根树得到默认版本 1 与解析后的根", () => {
    const root = tree();
    const created = createState(root);

    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }
    expect(created.state.version).toBe(1);
    expect(created.state.root.id).toBe("dendro.window");
    expect(created.state.root.children.map((child) => child.id)).toEqual([
      "ideas.feed",
      "ideas.search",
    ]);
  });

  it("显式版本号被接受", () => {
    const created = createState(tree(), 16);

    expect(created.ok && created.state.version).toBe(16);
  });

  it("重复 id 拒绝并给 E-ID-DUPLICATE 与现场", () => {
    const created = createState(
      node({
        id: "root",
        children: [node({ id: "dup" }), node({ id: "dup" })],
      }),
    );

    expect(created.ok).toBe(false);
    if (created.ok) {
      return;
    }
    const diagnostic = created.diagnostics[0];
    expect(diagnostic?.code).toBe("E-ID-DUPLICATE");
    expect(diagnostic?.path).toBe("$.root.children[1].id");
  });

  it("非法 kind 拒绝并给 E-PAYLOAD", () => {
    const created = createState(node({ id: "root", kind: "column" }));

    expect(created.ok).toBe(false);
    if (created.ok) {
      return;
    }
    expect(created.diagnostics[0]?.code).toBe("E-PAYLOAD");
    expect(created.diagnostics[0]?.path).toBe("$.root.kind");
  });

  it("非法版本拒绝并给 E-VERSION", () => {
    const created = createState(tree(), 0);

    expect(created.ok).toBe(false);
    if (created.ok) {
      return;
    }
    expect(created.diagnostics[0]?.code).toBe("E-VERSION");
    expect(created.diagnostics[0]?.path).toBe("$.version");
  });

  it("根树含不可深拷的值时拒绝并给 E-PAYLOAD", () => {
    const root = node({ id: "root", props: { callback: () => undefined } });

    const created = createState(root);

    expect(created.ok).toBe(false);
    if (created.ok) {
      return;
    }
    expect(created.diagnostics[0]?.code).toBe("E-PAYLOAD");
    expect(created.diagnostics[0]?.path).toBe("$.root");
  });

  it("状态持有深拷贝：之后改入参不影响文档", () => {
    const input = tree();
    const created = createState(input);

    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }
    const first = input.children[0];
    if (first === undefined) {
      throw new Error("测试树应有子节点");
    }
    first.props.mutated = true;
    expect(created.state.root.children[0]?.props.mutated).toBeUndefined();
  });
});

describe("DocumentIndex：三类查询", () => {
  it("get 覆盖 live 节点、模板根与模板内节点；未知 id 返回 undefined", () => {
    const index = indexOf();

    expect(index.get("dendro.window")?.kind).toBe("dendro:window");
    expect(index.get("ideas.feed#7")?.id).toBe("ideas.feed#7");
    expect(index.get("ideas.feed#tpl")?.id).toBe("ideas.feed#tpl");
    expect(index.get("ideas.feed#tpl.title")?.id).toBe("ideas.feed#tpl.title");
    expect(index.get("nope")).toBeUndefined();
  });

  it("parentOf：根 undefined、live 子节点真实序号、模板根记为所属 collection slot 的 -1", () => {
    const index = indexOf();

    expect(index.parentOf("dendro.window")).toBeUndefined();
    expect(index.parentOf("ideas.feed#7")).toEqual({ parentId: "ideas.feed", order: 1 });
    expect(index.parentOf("ideas.feed#tpl")).toEqual({ parentId: "ideas.feed", order: -1 });
    expect(index.parentOf("ideas.feed#tpl.title")).toEqual({
      parentId: "ideas.feed#tpl",
      order: 0,
    });
  });

  it("childrenOf：live 子节点不含模板根；模板节点返回自己的子节点；未知 id 空数组", () => {
    const index = indexOf();

    expect(index.childrenOf("ideas.feed").map((child) => child.id)).toEqual([
      "ideas.feed#42",
      "ideas.feed#7",
    ]);
    expect(index.childrenOf("ideas.feed#tpl").map((child) => child.id)).toEqual([
      "ideas.feed#tpl.title",
    ]);
    expect(index.childrenOf("nope")).toEqual([]);
  });

  it("childrenOf 返回副本：调用方改数组不影响树", () => {
    const index = indexOf();
    const children = index.childrenOf("ideas.feed");

    children.push(node({ id: "injected" }));

    expect(index.childrenOf("ideas.feed")).toHaveLength(2);
    expect(index.get("injected")).toBeUndefined();
  });

  it("size 与 ids 覆盖 templates，顺序固定（自身 → children → templates）", () => {
    const index = indexOf();

    expect(index.ids()).toEqual([
      "dendro.window",
      "ideas.feed",
      "ideas.feed#42",
      "ideas.feed#7",
      "ideas.feed#tpl",
      "ideas.feed#tpl.title",
      "ideas.search",
    ]);
    expect(index.size).toBe(7);
  });
});

describe("DocumentIndex：source 映射", () => {
  it("in[].source 被记为消费", () => {
    const index = indexOf();

    expect(index.slotsFor("net.status")).toEqual(["dendro.window", "ideas.search"]);
    expect(index.slotsFor("ideas.row")).toEqual(["ideas.feed#tpl.title"]);
  });

  it("collection.source 也算消费，同一 slot 的 in 与 collection 重复只记一次", () => {
    const index = indexOf();

    expect(index.slotsFor("ideas.feed")).toEqual(["ideas.feed"]);
  });

  it("未知 source 返回空数组", () => {
    expect(indexOf().slotsFor("nope")).toEqual([]);
  });
});

describe("DocumentIndex：独立重建", () => {
  it("同一棵树多次重建得到相同结果", () => {
    const first = indexOf();
    const second = indexOf();

    expect(second.ids()).toEqual(first.ids());
    for (const id of first.ids()) {
      expect(second.get(id)).toEqual(first.get(id));
      expect(second.parentOf(id)).toEqual(first.parentOf(id));
    }
  });

  it("从 createState 接管的根树重建，与直接从入参重建一致", () => {
    const created = createState(tree());
    if (!created.ok) {
      throw new Error("测试根树应合法");
    }

    const fromState = DocumentIndex.build(created.state.root);
    const fromInput = DocumentIndex.build(tree());

    expect(fromState.ids()).toEqual(fromInput.ids());
    expect(fromState.parentOf("ideas.feed#tpl")).toEqual({
      parentId: "ideas.feed",
      order: -1,
    });
  });
});

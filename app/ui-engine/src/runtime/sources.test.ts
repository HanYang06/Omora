import { describe, expect, it } from "vitest";
import type { SlotNode } from "../core/document";
import { WINDOW_SCAFFOLD } from "../link/scaffold";
import type { LocalTree } from "../link/types";
import { DocumentIndex } from "./document";
import { LifecycleLedger } from "./lifecycle";
import { SourceHost, type SourceHostResult } from "./sources";

/** 测试用槽位：默认 dendro:slot / test owner / 无子节点。 */
function slotNode(over: Partial<SlotNode> & { id: string }): SlotNode {
  return { kind: "dendro:slot", owner: "test", props: {}, children: [], ...over };
}

/** 测试用局部树：默认挂窗口主区、order / seq 0、不 replace。 */
function localTree(over: Partial<LocalTree> & { root: SlotNode }): LocalTree {
  return {
    owner: "test",
    mountAt: "dendro.window.page",
    order: 0,
    seq: 0,
    replace: false,
    ...over,
  };
}

/** 一页灵感：根 page.ideas 里声明 ideas.feed，供其他来源往里挂卡片。 */
function ideasPage(): LocalTree {
  return localTree({
    owner: "ideas",
    mountAt: "dendro.window.page",
    order: 10,
    root: slotNode({
      id: "page.ideas",
      kind: "dendro:page",
      owner: "ideas",
      layout: { flow: "column", capacity: "many" },
      children: [
        slotNode({
          id: "ideas.feed",
          owner: "ideas",
          layout: { flow: "column", capacity: "many" },
        }),
      ],
    }),
  });
}

/** 挂在某个 slot 上的叶子卡片。 */
function card(owner: string, id: string, mountAt: string, order = 20): LocalTree {
  return localTree({ owner, mountAt, order, root: slotNode({ id, kind: "ideas:card", owner }) });
}

/** 挂在 nav（capacity many）上的页面链接。 */
function nav(owner: string, id: string, order: number): LocalTree {
  return localTree({
    owner,
    mountAt: "dendro.window.nav",
    order,
    root: slotNode({ id, kind: "dendro:page-link", owner }),
  });
}

/** 卡片 + 在根里声明 audio.waveform，供下一层来源挂。 */
function audioCard(): LocalTree {
  return localTree({
    owner: "audio",
    mountAt: "ideas.feed",
    order: 20,
    root: slotNode({
      id: "audio.card",
      kind: "ideas:card",
      owner: "audio",
      children: [slotNode({ id: "audio.waveform", owner: "audio" })],
    }),
  });
}

function idsOf(root: SlotNode): string[] {
  return DocumentIndex.build(root).ids();
}

function childrenOf(root: SlotNode, id: string): string[] {
  return (DocumentIndex.build(root).get(id)?.children ?? []).map((child) => child.id);
}

function succeed(result: SourceHostResult) {
  if (!result.ok) {
    throw new Error("来源操作应成功: " + JSON.stringify(result.diagnostics));
  }
  return result;
}

function fail(result: SourceHostResult) {
  if (result.ok) {
    throw new Error("来源操作应失败");
  }
  return result.diagnostics;
}

describe("SourceHost：注册与注册表", () => {
  it("注册一个来源后，权威根树包含它的节点，size / sources / tree 同步", () => {
    const host = new SourceHost();
    expect(host.size).toBe(0);
    expect(host.sources.size).toBe(0);
    expect(host.tree).toEqual(WINDOW_SCAFFOLD);

    const result = succeed(host.register("ideas", [ideasPage()]));

    expect(result.dropped).toEqual([]);
    expect(result.diagnostics).toEqual([]);
    expect(result.tree).toBe(host.tree);
    expect(host.size).toBe(1);
    expect([...host.sources.keys()]).toEqual(["ideas"]);
    expect(host.sources.get("ideas")).toHaveLength(1);
    expect(idsOf(host.tree)).toEqual([
      "dendro.window",
      "dendro.window.nav",
      "dendro.window.page",
      "page.ideas",
      "ideas.feed",
    ]);
    expect(WINDOW_SCAFFOLD.children[1]?.children).toEqual([]);
  });

  it("再次 register 同一来源：旧树整棵换掉", () => {
    const host = new SourceHost();
    succeed(host.register("ideas", [ideasPage()]));
    const replacement = localTree({
      owner: "ideas",
      mountAt: "dendro.window.page",
      order: 10,
      root: slotNode({ id: "page.ideas.v2", kind: "dendro:page", owner: "ideas" }),
    });

    succeed(host.register("ideas", [replacement]));

    expect(childrenOf(host.tree, "dendro.window.page")).toEqual(["page.ideas.v2"]);
    expect(idsOf(host.tree)).not.toContain("page.ideas");
    expect(host.size).toBe(1);
  });

  it("同一组输入重复 register 幂等：根树内容一致、注册表不变", () => {
    const host = new SourceHost();
    succeed(host.register("ideas", [ideasPage()]));
    const first = structuredClone(host.tree);

    succeed(host.register("ideas", [ideasPage()]));

    expect(host.tree).toEqual(first);
    expect(host.size).toBe(1);
    expect(host.sources.get("ideas")).toEqual([ideasPage()]);
  });

  it("多个来源挂同一个 slot：按 order 排，且与注册顺序无关", () => {
    const forward = new SourceHost();
    succeed(forward.register("a", [nav("a", "nav.a", 20)]));
    succeed(forward.register("b", [nav("b", "nav.b", 10)]));
    const backward = new SourceHost();
    succeed(backward.register("b", [nav("b", "nav.b", 10)]));
    succeed(backward.register("a", [nav("a", "nav.a", 20)]));

    expect(childrenOf(forward.tree, "dendro.window.nav")).toEqual(["nav.b", "nav.a"]);
    expect(backward.tree).toEqual(forward.tree);
  });

  it("sources 是快照：改返回值不影响宿主注册表", () => {
    const host = new SourceHost();
    succeed(host.register("ideas", [ideasPage()]));

    const trees = host.sources.get("ideas") as LocalTree[] | undefined;
    if (trees === undefined) {
      throw new Error("快照里应有 ideas");
    }
    trees.push(card("ideas", "ideas.extra", "ideas.feed"));
    trees.pop();

    expect(host.sources.get("ideas")).toHaveLength(1);
    expect(host.size).toBe(1);
  });
});

describe("SourceHost：失败 fail closed", () => {
  it("落点还不存在：E-TARGET-MISSING 拒绝，registry 与树不变；依赖就位后可再注册", () => {
    const host = new SourceHost();

    const diagnostics = fail(host.register("audio", [card("audio", "audio.card", "ideas.feed")]));

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["E-TARGET-MISSING"]);
    expect(diagnostics[0]?.owner).toBe("audio");
    expect(diagnostics[0]?.slot).toBe("ideas.feed");
    expect(host.size).toBe(0);
    expect(host.sources.size).toBe(0);
    expect(host.tree).toEqual(WINDOW_SCAFFOLD);

    succeed(host.register("ideas", [ideasPage()]));
    succeed(host.register("audio", [card("audio", "audio.card", "ideas.feed")]));

    expect(childrenOf(host.tree, "ideas.feed")).toEqual(["audio.card"]);
  });

  it("capacity one 的 page 被两个来源挂：E-SLOT-CAPACITY 拒绝，registry 与树不变", () => {
    const host = new SourceHost();
    succeed(host.register("ideas", [ideasPage()]));
    const before = structuredClone(host.tree);
    const other = localTree({
      owner: "other",
      mountAt: "dendro.window.page",
      order: 20,
      root: slotNode({ id: "page.other", kind: "dendro:page", owner: "other" }),
    });

    const diagnostics = fail(host.register("other", [other]));

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["E-SLOT-CAPACITY"]);
    expect(host.size).toBe(1);
    expect([...host.sources.keys()]).toEqual(["ideas"]);
    expect(host.tree).toEqual(before);
  });

  it("同 slot 不同来源的 order 相同：E-SLOT-AMBIGUOUS 拒绝，registry 与树不变", () => {
    const base = slotNode({
      id: "root",
      layout: { flow: "column", capacity: "many" },
      children: [slotNode({ id: "root.area", layout: { flow: "column", capacity: "many" } })],
    });
    const nodeAt = (owner: string, order: number) =>
      localTree({
        owner,
        mountAt: "root.area",
        order,
        root: slotNode({ id: owner + ".node", owner }),
      });
    const host = new SourceHost({ base });
    succeed(host.register("a", [nodeAt("a", 10)]));
    const before = structuredClone(host.tree);

    const diagnostics = fail(host.register("b", [nodeAt("b", 10)]));

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["E-SLOT-AMBIGUOUS"]);
    expect(diagnostics[0]?.slot).toBe("root.area");
    expect(host.size).toBe(1);
    expect(host.tree).toEqual(before);

    succeed(host.register("b", [nodeAt("b", 20)]));
    expect(childrenOf(host.tree, "root.area")).toEqual(["a.node", "b.node"]);
  });

  it("自环局部树：E-CYCLE 拒绝，registry 与树不变", () => {
    const host = new SourceHost();
    const root = slotNode({
      id: "c.root",
      owner: "c",
      children: [slotNode({ id: "c.slot", owner: "c" })],
    });

    const diagnostics = fail(
      host.register("c", [localTree({ owner: "c", mountAt: "c.slot", root })]),
    );

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["E-CYCLE"]);
    expect(host.size).toBe(0);
    expect(host.tree).toEqual(WINDOW_SCAFFOLD);
  });

  it("owner 不一致 / root.owner 不一致：E-PAYLOAD 拒绝、registry 不变", () => {
    const host = new SourceHost();
    const treeOwner = fail(host.register("a", [card("b", "b.card", "dendro.window.nav")]));
    expect(treeOwner.map((diagnostic) => diagnostic.code)).toEqual(["E-PAYLOAD"]);
    expect(treeOwner[0]?.owner).toBe("a");
    expect(treeOwner[0]?.message).toContain("b");

    const rootOwner = fail(
      host.register("a", [
        localTree({
          owner: "a",
          mountAt: "dendro.window.nav",
          root: slotNode({ id: "a.nav", owner: "b" }),
        }),
      ]),
    );
    expect(rootOwner.map((diagnostic) => diagnostic.code)).toEqual(["E-PAYLOAD"]);
    expect(rootOwner[0]?.message).toContain("root.owner");

    expect(fail(host.register("", [nav("x", "nav.x", 10)])).map((d) => d.code)).toEqual([
      "E-PAYLOAD",
    ]);
    expect(host.size).toBe(0);
    expect(host.tree).toEqual(WINDOW_SCAFFOLD);
  });

  it("不改写入参：局部树与 base 在注册后保持原样", () => {
    const base = slotNode({
      id: "root",
      layout: { flow: "column", capacity: "many" },
      children: [slotNode({ id: "root.area", layout: { flow: "column", capacity: "many" } })],
    });
    const tree = localTree({
      owner: "a",
      mountAt: "root.area",
      root: slotNode({ id: "a.node", owner: "a" }),
    });
    const beforeBase = structuredClone(base);
    const beforeTree = structuredClone(tree);
    const host = new SourceHost({ base });

    succeed(host.register("a", [tree]));

    expect(tree).toEqual(beforeTree);
    expect(base).toEqual(beforeBase);
  });
});

describe("SourceHost：remove 与级联", () => {
  it("remove 让依赖来源级联撤掉：tree 回 base，dropped 与死引用诊断都有记录", () => {
    const host = new SourceHost();
    succeed(host.register("ideas", [ideasPage()]));
    succeed(host.register("audio", [card("audio", "audio.card", "ideas.feed")]));

    const result = succeed(host.remove("ideas"));

    expect(result.dropped).toEqual([{ owner: "audio", mountAt: "ideas.feed" }]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["E-TARGET-MISSING"]);
    expect(result.diagnostics[0]?.owner).toBe("audio");
    expect(result.diagnostics[0]?.slot).toBe("ideas.feed");
    expect(result.tree).toEqual(WINDOW_SCAFFOLD);
    expect(idsOf(result.tree)).not.toContain("audio.card");
    expect(host.size).toBe(0);
    expect(host.sources.size).toBe(0);
  });

  it("级联多层：B 挂 A 的 slot、C 挂 B 的 slot，一次 remove 全部撤掉且结果确定", () => {
    const build = () => {
      const host = new SourceHost();
      succeed(host.register("ideas", [ideasPage()]));
      succeed(host.register("audio", [audioCard()]));
      succeed(host.register("video", [card("video", "video.card", "audio.waveform")]));
      return host;
    };

    const result = succeed(build().remove("ideas"));

    expect(result.dropped).toEqual([
      { owner: "audio", mountAt: "ideas.feed" },
      { owner: "video", mountAt: "audio.waveform" },
    ]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "E-TARGET-MISSING",
      "E-TARGET-MISSING",
    ]);
    expect(new Set(result.diagnostics.map((diagnostic) => diagnostic.owner))).toEqual(
      new Set(["audio", "video"]),
    );
    expect(result.tree).toEqual(WINDOW_SCAFFOLD);

    const again = succeed(build().remove("ideas"));
    expect(again.tree).toEqual(result.tree);
    expect(again.dropped).toEqual(result.dropped);
    expect(again.diagnostics).toEqual(result.diagnostics);
  });

  it("级联只撤失去落点的树：同一来源的其他树保留", () => {
    const host = new SourceHost();
    succeed(host.register("ideas", [ideasPage()]));
    succeed(host.register("audio", [audioCard(), nav("audio", "nav.audio", 10)]));

    const result = succeed(host.remove("ideas"));

    expect(result.dropped).toEqual([{ owner: "audio", mountAt: "ideas.feed" }]);
    expect(host.size).toBe(1);
    expect(host.sources.get("audio")).toHaveLength(1);
    expect(idsOf(host.tree)).toContain("nav.audio");
    expect(idsOf(host.tree)).not.toContain("audio.card");
  });

  it("remove 未注册来源是幂等空操作", () => {
    const host = new SourceHost();
    succeed(host.register("ideas", [ideasPage()]));
    const before = structuredClone(host.tree);

    const result = succeed(host.remove("ghost"));

    expect(result.tree).toEqual(before);
    expect(result.dropped).toEqual([]);
    expect(result.diagnostics).toEqual([]);
    expect(host.size).toBe(1);
  });

  it("remove 重链接出现非死引用错误：整次回滚，registry 与 tree 不变", () => {
    const base = slotNode({
      id: "root",
      layout: { flow: "column", capacity: "many" },
      children: [slotNode({ id: "root.area", layout: { flow: "column", capacity: "many" } })],
    });
    const host = new SourceHost({ base });
    succeed(
      host.register("a", [
        localTree({
          owner: "a",
          mountAt: "root.area",
          order: 10,
          root: slotNode({ id: "a.node", owner: "a" }),
        }),
      ]),
    );
    succeed(
      host.register("b", [
        localTree({
          owner: "b",
          mountAt: "root.area",
          order: 20,
          root: slotNode({ id: "b.node", owner: "b" }),
        }),
      ]),
    );
    const before = structuredClone(host.tree);
    // base 按引用保存（见 sources.ts 边界）：构造后改小容量，制造「撤树修不好」的重链接失败。
    const area = base.children[0];
    if (area === undefined || area.layout === undefined) {
      throw new Error("测试 base 应有 root.area 与其 layout");
    }
    area.layout.capacity = "none";

    const diagnostics = fail(host.remove("a"));

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["E-SLOT-CAPACITY"]);
    expect(host.tree).toEqual(before);
    expect(host.size).toBe(2);
    expect(host.sources.get("a")).toHaveLength(1);
  });
});

describe("SourceHost：dispose", () => {
  it("dispose 收口账本、幂等；之后 register / remove 一律 E-PAYLOAD 拒绝", () => {
    const ledger = new LifecycleLedger();
    const order: string[] = [];
    ledger.add(() => order.push("cleanup"));
    const host = new SourceHost({ ledger });
    succeed(host.register("ideas", [ideasPage()]));
    const before = structuredClone(host.tree);

    const report = host.dispose();

    expect(report).toEqual({ disposed: 1, errors: [] });
    expect(order).toEqual(["cleanup"]);
    expect(ledger.disposed).toBe(true);
    expect(host.dispose()).toEqual({ disposed: 0, errors: [] });

    const failures = [
      fail(host.register("audio", [card("audio", "audio.card", "ideas.feed")])),
      fail(host.remove("ideas")),
    ];
    for (const diagnostics of failures) {
      expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["E-PAYLOAD"]);
      expect(diagnostics[0]?.message).toContain("dispose");
    }
    expect(host.size).toBe(1);
    expect(host.tree).toEqual(before);
    expect(host.sources.get("ideas")).toHaveLength(1);
  });
});

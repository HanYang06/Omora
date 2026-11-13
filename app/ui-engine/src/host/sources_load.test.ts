import { describe, expect, it } from "vitest";
import type { SlotNode } from "../contract/document";
import { WINDOW_SCAFFOLD } from "../link/scaffold";
import { slot, tree } from "../link/test_fixtures";
import type { LocalTree } from "../link/types";
import { DocumentIndex } from "../engine/document/document";
import { SourceHost, type SourceHostResult } from "./sources";

/**
 * SourceHost.load（S5：线上 local-trees 全量负载的宿主入口）与 requesterFor 透传。
 *
 * 单独成文件（sources.test.ts 已 460 行）：load 整组替换与空数组清空、跨 owner 依赖、
 * 与到达顺序无关、坏输入 / 链接失败的 fail closed、链接期权限透传、dispose 后拒绝。
 */

/** 一页灵感：根 page.ideas 里声明 ideas.feed，供其他来源（含跨 owner）往里挂卡片。 */
function ideasPage(): LocalTree {
  return tree({
    owner: "ideas",
    mountAt: "dendro.window.page",
    order: 10,
    root: slot({
      id: "page.ideas",
      kind: "dendro:page",
      owner: "ideas",
      layout: { flow: "column", capacity: "many" },
      children: [
        slot({ id: "ideas.feed", owner: "ideas", layout: { flow: "column", capacity: "many" } }),
      ],
    }),
  });
}

/** 挂在某个 slot 上的叶子卡片。 */
function card(owner: string, id: string, mountAt: string, order = 20): LocalTree {
  return tree({ owner, mountAt, order, root: slot({ id, kind: "ideas:card", owner }) });
}

/** 挂在 nav（capacity many）上的页面链接。 */
function nav(owner: string, id: string, order: number): LocalTree {
  return tree({
    owner,
    mountAt: "dendro.window.nav",
    order,
    root: slot({ id, kind: "dendro:page-link", owner }),
  });
}

/** 两区 base：root.area 是 capacity many 的挂载区，权限用例往它上面补 grant。 */
function twoAreaBase(): SlotNode {
  return slot({
    id: "root",
    layout: { flow: "column", capacity: "many" },
    children: [slot({ id: "root.area", layout: { flow: "column", capacity: "many" } })],
  });
}

/** 两区 base + root.area 上的 mount grant（线上扁平 grant 形状）。 */
function grantedBase(tokens: string[]): SlotNode {
  const base = twoAreaBase();
  const area = base.children[0];
  if (area === undefined) {
    throw new Error("测试 base 应有 root.area");
  }
  area.grant = { mount: tokens } as unknown as SlotNode["grant"];
  return base;
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

function codesOf(result: SourceHostResult): string[] {
  return fail(result).map((diagnostic) => diagnostic.code);
}

describe("SourceHost.load：整组替换", () => {
  it("一次 load 落成跨 owner 依赖并整组替换注册表，空数组清空来源", () => {
    const host = new SourceHost();
    succeed(host.register("stale", [nav("stale", "nav.stale", 30)]));
    expect(idsOf(host.tree)).toContain("nav.stale");

    succeed(host.load([ideasPage(), card("audio", "audio.card", "ideas.feed")]));

    expect([...host.sources.keys()]).toEqual(["audio", "ideas"]);
    expect(childrenOf(host.tree, "ideas.feed")).toEqual(["audio.card"]);
    expect(idsOf(host.tree)).not.toContain("nav.stale");

    succeed(host.load([]));
    expect(host.size).toBe(0);
    expect(host.tree).toEqual(WINDOW_SCAFFOLD);
  });

  it("与树的到达顺序无关：反序 load 得到同一棵树", () => {
    const forward = new SourceHost();
    succeed(forward.load([ideasPage(), card("audio", "audio.card", "ideas.feed")]));
    const backward = new SourceHost();
    succeed(backward.load([card("audio", "audio.card", "ideas.feed"), ideasPage()]));

    expect(backward.tree).toEqual(forward.tree);
  });
});

describe("SourceHost.load：fail closed", () => {
  it("坏输入（非数组 / 非对象 / owner 空）E-PAYLOAD，注册表与树不变", () => {
    const host = new SourceHost();
    succeed(host.load([ideasPage()]));
    const before = structuredClone(host.tree);
    const inputs: unknown[] = ["nope", [null], [tree({ owner: "", root: slot({ id: "ghost" }) })]];

    for (const trees of inputs) {
      expect(codesOf(host.load(trees as LocalTree[]))).toEqual(["E-PAYLOAD"]);
    }
    expect(host.size).toBe(1);
    expect([...host.sources.keys()]).toEqual(["ideas"]);
    expect(host.tree).toEqual(before);
  });

  it("链接失败（跨 owner 依赖的页不在同一批）E-TARGET-MISSING，registry 与树保持 load 前", () => {
    const host = new SourceHost();
    succeed(host.load([ideasPage()]));
    const before = structuredClone(host.tree);

    const diagnostics = fail(host.load([card("audio", "audio.card", "ideas.feed")]));

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["E-TARGET-MISSING"]);
    expect(host.tree).toEqual(before);
    expect([...host.sources.keys()]).toEqual(["ideas"]);
  });
});

describe("SourceHost：requesterFor 透传链接期权限", () => {
  it("允许时 load 与 register 都按主体落成", () => {
    const host = new SourceHost({
      base: grantedBase(["owner:guest"]),
      requesterFor: () => ({ owner: "guest" }),
    });

    succeed(host.load([card("a", "a.card", "root.area", 10)]));
    succeed(host.register("b", [card("b", "b.card", "root.area", 20)]));

    expect(childrenOf(host.tree, "root.area")).toEqual(["a.card", "b.card"]);
  });

  it("拒绝时 register / load / remove 都 E-PERMISSION 且回滚", () => {
    let requester = { owner: "guest" };
    const host = new SourceHost({
      base: grantedBase(["owner:guest"]),
      requesterFor: () => requester,
    });

    requester = { owner: "stranger" };
    expect(codesOf(host.register("c", [card("c", "c.card", "root.area", 30)]))).toEqual([
      "E-PERMISSION",
    ]);
    expect(host.size).toBe(0);

    requester = { owner: "guest" };
    succeed(host.load([card("a", "a.card", "root.area", 10)]));
    succeed(host.register("b", [card("b", "b.card", "root.area", 20)]));
    const before = structuredClone(host.tree);

    requester = { owner: "stranger" };
    const denials = [host.load([card("a", "a.card", "root.area", 10)]), host.remove("a")];
    for (const result of denials) {
      expect(codesOf(result)).toEqual(["E-PERMISSION"]);
    }
    expect(host.tree).toEqual(before);
    expect([...host.sources.keys()]).toEqual(["a", "b"]);
  });
});

describe("SourceHost：dispose 之后 load", () => {
  it("dispose 收口后 load 一律 E-PAYLOAD 拒绝，registry 与树不再变", () => {
    const host = new SourceHost();
    succeed(host.load([ideasPage()]));
    const before = structuredClone(host.tree);

    host.dispose();
    const diagnostics = fail(host.load([]));

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["E-PAYLOAD"]);
    expect(diagnostics[0]?.message).toContain("dispose");
    expect(host.tree).toEqual(before);
  });
});

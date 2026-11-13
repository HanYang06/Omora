/**
 * 链接期权限（S4）：局部树挂载检查。
 *
 * 证明的行为：默认系统来源全放行（S2 行为不回归）；受限来源对目标 slot 没有
 * mount / replace 能力时整次链接失败（E-PERMISSION、不产树、入参不变）；结构错误
 * 先于权限报；grant 的各类 token 在链接期生效。语义见 docs/engine/permissions.md §4。
 *
 * 夹具说明：带 grant 的目标 slot 放在局部树里（payload 会经 parseLocalTrees 规范化，
 * grant 才被包成内部 `{capabilities}` 形状）；base 走 S2 的原始克隆。
 */

import { describe, expect, it } from "vitest";
import type { Grant, SlotNode } from "../contract/document";
import { SYSTEM_REQUESTER, type Requester } from "../runtime/permissions";
import { link } from "./link";
import { WINDOW_SCAFFOLD } from "./scaffold";
import type { Diagnostic, DiagnosticCode } from "../contract/diagnostics";
import type { LinkOptions, LinkResult } from "./types";
import { expectLinked, fixturePayload, payloadOf, slot, tree } from "./test_fixtures";

const RESTRICTED: Requester = { owner: "eco" };

/**
 * 线上 grant 是扁平的能力表（Python Grant.to_json() 与 parseGrant 的输入）；
 * Grant 类型描述的是解析后的内部形状，这里只做这一处边界转换（沿用 runtime 测试做法）。
 */
function wireGrant(capabilities: Record<string, string[]>): Grant {
  return capabilities as unknown as Grant;
}

/** 所有局部树都用同一个受限主体。 */
function restrictedTo(owner: string): LinkOptions {
  return { requesterFor: () => ({ owner }) };
}

/** 按树 owner 指定主体；没列出的走系统来源。 */
function restrictedFor(mapping: Record<string, Requester>): LinkOptions {
  return { requesterFor: (localTree) => mapping[localTree.owner] ?? SYSTEM_REQUESTER };
}

interface GuestSpec {
  replace?: boolean;
  requester?: Requester;
}

/**
 * host 树（系统来源）挂到窗口骨架，并在自己子树里声明一个带 grant 的目标 slot；
 * guest 树（默认受限来源 eco）挂到那个目标 slot 上。
 */
function hostFixture(
  capabilities: Record<string, string[]>,
  guest: GuestSpec = {},
): { payload: ReturnType<typeof payloadOf>; options: LinkOptions } {
  const hostTree = tree({
    owner: "host",
    order: 10,
    root: slot({
      id: "host.page",
      owner: "host",
      layout: { flow: "column", capacity: "many" },
      children: [
        slot({
          id: "host.slot",
          owner: "host",
          grant: wireGrant(capabilities),
          children: [slot({ id: "host.old", owner: "host" })],
        }),
      ],
    }),
  });
  const guestTree = tree({
    owner: "eco",
    order: 20,
    mountAt: "host.slot",
    replace: guest.replace ?? false,
    root: slot({ id: "eco.row", owner: "eco" }),
  });
  const options = restrictedFor({ host: SYSTEM_REQUESTER, eco: guest.requester ?? RESTRICTED });
  return { payload: payloadOf([hostTree, guestTree]), options };
}

function failureDiagnostics(result: LinkResult): Diagnostic[] {
  if (result.ok) {
    throw new Error("应链接失败，实际成功");
  }
  return result.diagnostics;
}

function codes(result: LinkResult): DiagnosticCode[] {
  return failureDiagnostics(result).map((diagnostic) => diagnostic.code);
}

function findSlot(root: SlotNode, id: string): SlotNode | undefined {
  if (root.id === id) {
    return root;
  }
  for (const child of root.children) {
    const found = findSlot(child, id);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

function mustFindSlot(root: SlotNode, id: string): SlotNode {
  const found = findSlot(root, id);
  if (found === undefined) {
    throw new Error("测试数据里找不到 slot: " + id);
  }
  return found;
}

describe("link：默认系统来源全放行", () => {
  it("不给 options 与显式系统 requester 得到同一棵树", () => {
    const payload = fixturePayload();
    const implicit = expectLinked(link(WINDOW_SCAFFOLD, payload));
    const explicit = expectLinked(
      link(WINDOW_SCAFFOLD, payload, { requesterFor: () => SYSTEM_REQUESTER }),
    );

    expect(JSON.stringify(explicit.tree)).toBe(JSON.stringify(implicit.tree));
    expect([...explicit.ids.keys()].sort()).toEqual([...implicit.ids.keys()].sort());
  });

  it("骨架目标 slot 没有 grant 也照常链接（S2 行为不回归）", () => {
    const result = expectLinked(link(WINDOW_SCAFFOLD, fixturePayload()));

    expect(result.ids.get("dendro.window.page")?.children.map((child) => child.id)).toEqual([
      "page.ideas",
    ]);
    expect(result.ids.get("dendro.window.nav")?.children.map((child) => child.id)).toEqual([
      "nav.ideas",
    ]);
  });
});

describe("link：受限来源越权挂载 → E-PERMISSION", () => {
  it("目标 slot 没有 grant：拒绝并带 owner / slot / capability 现场", () => {
    const base = slot({ id: "root" });
    const payload = payloadOf([
      tree({ owner: "eco", mountAt: "root", root: slot({ id: "eco.node", owner: "eco" }) }),
    ]);

    const result = link(base, payload, restrictedTo("eco"));

    expect(result.ok).toBe(false);
    expect("tree" in result).toBe(false);
    const permission = failureDiagnostics(result).find(
      (diagnostic) => diagnostic.code === "E-PERMISSION",
    );
    expect(permission?.owner).toBe("eco");
    expect(permission?.slot).toBe("root");
    expect(permission?.message).toContain("mount");
    expect(permission?.message).toContain("eco");
  });

  it("grant mount: [any] 放行", () => {
    const { payload, options } = hostFixture({ mount: ["any"] });

    const result = expectLinked(link(WINDOW_SCAFFOLD, payload, options));

    expect(result.ids.get("host.slot")?.children.map((child) => child.id)).toEqual([
      "host.old",
      "eco.row",
    ]);
  });

  it("grant mount: [owner:eco] 放行", () => {
    const { payload, options } = hostFixture({ mount: ["owner:eco"] });

    expectLinked(link(WINDOW_SCAFFOLD, payload, options));
  });

  it("grant mount: [role:viewer] 命中 requester.roles 放行", () => {
    const { payload, options } = hostFixture(
      { mount: ["role:viewer"] },
      { requester: { owner: "eco", roles: ["viewer"] } },
    );

    expectLinked(link(WINDOW_SCAFFOLD, payload, options));
  });

  it("grant mount: [tier:signed] 命中 requester.tiers 放行", () => {
    const { payload, options } = hostFixture(
      { mount: ["tier:signed"] },
      { requester: { owner: "eco", tiers: ["signed"] } },
    );

    expectLinked(link(WINDOW_SCAFFOLD, payload, options));
  });

  it("grant mount 里的裸 token 按 owner id 匹配", () => {
    const { payload, options } = hostFixture({ mount: ["eco"] });

    expectLinked(link(WINDOW_SCAFFOLD, payload, options));
  });

  it("grant token 不命中 requester 的 role 时拒绝", () => {
    const { payload, options } = hostFixture(
      { mount: ["role:viewer"] },
      { requester: { owner: "eco", roles: ["author"] } },
    );

    expect(codes(link(WINDOW_SCAFFOLD, payload, options))).toEqual(["E-PERMISSION"]);
  });

  it("无法识别的 grant token 一律拒绝", () => {
    const { payload, options } = hostFixture({ mount: ["nobody:eco"] });

    expect(codes(link(WINDOW_SCAFFOLD, payload, options))).toEqual(["E-PERMISSION"]);
  });

  it("目标 slot 的 owner 本人不需要 grant 也能挂（与运行期 can 同语义）", () => {
    const { payload, options } = hostFixture({}, { requester: { owner: "host" } });

    expectLinked(link(WINDOW_SCAFFOLD, payload, options));
  });
});

describe("link：replace 挂载需要替换能力", () => {
  it("目标 slot 只有 mount 能力时 replace 被拒，消息写出 capability", () => {
    const { payload, options } = hostFixture({ mount: ["any"] }, { replace: true });

    const result = link(WINDOW_SCAFFOLD, payload, options);

    expect(result.ok).toBe(false);
    const permission = failureDiagnostics(result).find(
      (diagnostic) => diagnostic.code === "E-PERMISSION",
    );
    expect(permission?.message).toContain("replace");
    expect(permission?.slot).toBe("host.slot");
  });

  it("目标 slot 有 replace 能力时替换生效，旧子节点从索引消失", () => {
    const { payload, options } = hostFixture({ replace: ["any"] }, { replace: true });

    const result = expectLinked(link(WINDOW_SCAFFOLD, payload, options));

    expect(result.ids.get("host.slot")?.children.map((child) => child.id)).toEqual(["eco.row"]);
    expect(result.ids.has("host.old")).toBe(false);
  });

  it("replace 被拒时不产树、入参不变", () => {
    const { payload, options } = hostFixture({ mount: ["any"] }, { replace: true });
    const payloadCopy = structuredClone(payload);

    const result = link(WINDOW_SCAFFOLD, payload, options);

    expect(result.ok).toBe(false);
    expect("tree" in result).toBe(false);
    expect(payload).toEqual(payloadCopy);
  });
});

describe("link：权限失败的原子性", () => {
  it("同 slot 多个挂载中一个被拒 → 整次失败，只指出被拒的那棵", () => {
    const hostTree = tree({
      owner: "host",
      order: 10,
      root: slot({
        id: "host.page",
        owner: "host",
        children: [
          slot({
            id: "host.slot",
            owner: "host",
            grant: wireGrant({ mount: ["owner:ok"] }),
          }),
        ],
      }),
    });
    const payload = payloadOf([
      hostTree,
      tree({
        owner: "ok",
        order: 10,
        mountAt: "host.slot",
        root: slot({ id: "ok.row", owner: "ok" }),
      }),
      tree({
        owner: "eco",
        order: 20,
        mountAt: "host.slot",
        root: slot({ id: "eco.row", owner: "eco" }),
      }),
    ]);
    const options = restrictedFor({
      host: SYSTEM_REQUESTER,
      ok: { owner: "ok" },
      eco: RESTRICTED,
    });

    const result = link(WINDOW_SCAFFOLD, payload, options);

    expect(result.ok).toBe(false);
    expect("tree" in result).toBe(false);
    const diagnostics = failureDiagnostics(result);
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["E-PERMISSION"]);
    expect(diagnostics[0]?.owner).toBe("eco");
  });

  it("受限来源下共享 fixture 失败：不产树、不改骨架与 payload", () => {
    const payload = structuredClone(fixturePayload());
    const payloadCopy = structuredClone(payload);
    const scaffoldCopy = structuredClone(WINDOW_SCAFFOLD);

    const result = link(WINDOW_SCAFFOLD, payload, restrictedTo("eco"));

    expect(result.ok).toBe(false);
    expect("tree" in result).toBe(false);
    expect(payload).toEqual(payloadCopy);
    expect(WINDOW_SCAFFOLD).toEqual(scaffoldCopy);
  });
});

describe("link：结构错误先于权限报", () => {
  it("落点不存在：报 E-TARGET-MISSING，不报 E-PERMISSION", () => {
    const base = slot({ id: "root" });
    const payload = payloadOf([
      tree({ owner: "eco", mountAt: "ghost.slot", root: slot({ id: "eco.node", owner: "eco" }) }),
    ]);

    const resultCodes = codes(link(base, payload, restrictedTo("eco")));

    expect(resultCodes).toContain("E-TARGET-MISSING");
    expect(resultCodes).not.toContain("E-PERMISSION");
  });

  it("同 slot 歧义：报 E-SLOT-AMBIGUOUS，不报 E-PERMISSION", () => {
    const base = slot({ id: "root" });
    const payload = payloadOf([
      tree({ owner: "a", order: 0, mountAt: "root", root: slot({ id: "a.node", owner: "a" }) }),
      tree({ owner: "b", order: 0, mountAt: "root", root: slot({ id: "b.node", owner: "b" }) }),
    ]);
    const options = restrictedFor({ a: RESTRICTED, b: RESTRICTED });

    const resultCodes = codes(link(base, payload, options));

    expect(resultCodes).toContain("E-SLOT-AMBIGUOUS");
    expect(resultCodes).not.toContain("E-PERMISSION");
  });

  it("replace 独占冲突：报 E-SLOT-CAPACITY，不报 E-PERMISSION", () => {
    const base = slot({ id: "root", layout: { flow: "column", capacity: "many" } });
    const payload = payloadOf([
      tree({
        owner: "a",
        order: 10,
        mountAt: "root",
        replace: true,
        root: slot({ id: "a.node", owner: "a" }),
      }),
      tree({ owner: "b", order: 20, mountAt: "root", root: slot({ id: "b.node", owner: "b" }) }),
    ]);
    const options = restrictedFor({ a: RESTRICTED, b: RESTRICTED });

    const resultCodes = codes(link(base, payload, options));

    expect(resultCodes).toContain("E-SLOT-CAPACITY");
    expect(resultCodes).not.toContain("E-PERMISSION");
  });
});

describe("link：与窗口骨架的真实 fixture 组合", () => {
  it("系统来源挂页，受限来源挂进另一棵树声明 grant 的 feed slot", () => {
    const payload = structuredClone(fixturePayload());
    const pageTree = payload.trees.find((localTree) => localTree.root.id === "page.ideas");
    if (pageTree === undefined) {
      throw new Error("共享 fixture 少了 page.ideas 树");
    }
    mustFindSlot(pageTree.root, "ideas.feed").grant = wireGrant({ mount: ["any"] });
    const options: LinkOptions = {
      requesterFor: (localTree) =>
        localTree.root.id === "page.ideas" || localTree.root.id === "nav.ideas"
          ? SYSTEM_REQUESTER
          : RESTRICTED,
    };

    const result = expectLinked(link(WINDOW_SCAFFOLD, payload, options));

    expect(result.ids.get("dendro.window.nav")?.children.map((child) => child.id)).toEqual([
      "nav.ideas",
    ]);
    expect(result.ids.get("dendro.window.page")?.children.map((child) => child.id)).toEqual([
      "page.ideas",
    ]);
    expect(result.ids.get("ideas.feed")?.children.map((child) => child.id)).toEqual([
      "ideas.feed#42",
      "ideas.feed#7",
    ]);
  });

  it("同一份 fixture：默认来源链接成功，受限来源只出自 E-PERMISSION", () => {
    const payload = fixturePayload();
    expectLinked(link(WINDOW_SCAFFOLD, payload));

    const resultCodes = codes(link(WINDOW_SCAFFOLD, payload, restrictedTo("eco")));

    expect(resultCodes.length).toBeGreaterThan(0);
    expect(resultCodes.every((code) => code === "E-PERMISSION")).toBe(true);
  });
});

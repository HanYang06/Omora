import { describe, expect, it } from "vitest";
import type { SlotNode } from "../core/document";
import { link } from "./link";
import type { Requester } from "./types";

/**
 * base 归一化 + 链接期权限：base 上的 grant 在线上是扁平能力表，链接器必须先用
 * parseDocument 归一，否则权限检查器读不到 grant（受限来源会被误拒）。
 */

type WireSlot = Record<string, unknown>;

function slot(over: WireSlot = {}): WireSlot {
  return { id: "root", kind: "dendro:slot", owner: "dendro", props: {}, children: [], ...over };
}

function baseWithGrant(): WireSlot {
  return slot({
    children: [
      slot({
        id: "target",
        layout: { flow: "column", capacity: "many" },
        grant: { mount: ["owner:guest"], replace: ["owner:guest"] },
      }),
    ],
  });
}

function tree(options: { replace?: boolean } = {}): WireSlot {
  return {
    owner: "guest",
    mountAt: "target",
    order: 10,
    seq: 1,
    ...(options.replace === true ? { replace: true } : {}),
    root: {
      id: "guest.item",
      kind: "dendro:text",
      owner: "guest",
      props: { text: "hi" },
      children: [],
    },
  };
}

function payload(options: { replace?: boolean } = {}): WireSlot {
  return { kind: "local-trees", seq: 1, trees: [tree(options)] };
}

const guest: Requester = { owner: "guest" };
const stranger: Requester = { owner: "stranger" };

function linkAs(requester: Requester, options: { replace?: boolean } = {}) {
  return link(baseWithGrant() as unknown as SlotNode, payload(options), {
    requesterFor: () => requester,
  });
}

describe("链接期权限：base 的扁平 grant 能生效", () => {
  it("被 base grant 允许的来源可以挂载", () => {
    const result = linkAs(guest);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const target = result.ids.get("target");
    expect(target?.children.map((child) => child.id)).toEqual(["guest.item"]);
  });

  it("未授权的来源被 E-PERMISSION 拒绝，且不产树", () => {
    const result = linkAs(stranger);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.diagnostics[0]?.code).toBe("E-PERMISSION");
    expect(result.diagnostics[0]?.slot).toBe("target");
  });

  it("replace 挂载需要 replace 能力（只有 mount grant 不够）", () => {
    const base = baseWithGrant();
    const children = base.children as WireSlot[];
    const target = children[0];
    if (target !== undefined) {
      target.grant = { mount: ["owner:guest"] };
    }
    const result = link(base as unknown as SlotNode, payload({ replace: true }), {
      requesterFor: () => guest,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0]?.code).toBe("E-PERMISSION");
    }
  });

  it("系统来源默认全放行（不传 requesterFor）", () => {
    const result = link(baseWithGrant() as unknown as SlotNode, payload());
    expect(result.ok).toBe(true);
  });
});

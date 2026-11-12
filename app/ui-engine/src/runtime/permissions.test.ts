import { describe, expect, it } from "vitest";
import type { Grant, SlotNode } from "../core/document";
import { applyData, type DataState } from "./data";
import {
  SYSTEM_REQUESTER,
  can,
  checkPermission,
  type Capability,
  type Requester,
} from "./permissions";
import { node, stateOf } from "./test_fixtures";

/**
 * 权限薄层的两层行为：
 * 1) can / checkPermission：能力 × 主体（permissions.md §2 / §3）；
 * 2) applyData 的接入：真正会被写到的 slot 要 update 能力，拒绝时文档与数据都不变。
 *
 * ops 的接入在 ops_permissions.test.ts；默认 SYSTEM_REQUESTER 的现有行为由既有
 * ops.test.ts / data.test.ts 继续覆盖。
 */

const CAPABILITIES: Capability[] = [
  "read",
  "mount",
  "replace",
  "update",
  "remove",
  "observe",
  "intercept",
];

function slot(over: Partial<SlotNode> = {}): SlotNode {
  return node({ id: "target", owner: "ideas", ...over });
}

/**
 * 线上 grant 是扁平的能力表（Python `Grant.to_json()` 与本文件的 can() 直测都按这个
 * 语义），parseGrant 解析后才包成内部的 `{capabilities}`；类型 `Grant` 描述的是后者。
 * 测试夹具要先把线上形状喂给 parseDocument，这里只做这一处边界转换。
 */
function wireGrant(capabilities: Record<string, string[]>): Grant {
  return capabilities as unknown as Grant;
}

function granted(capabilities: Record<string, string[]>): SlotNode {
  return slot({ grant: { capabilities } });
}

describe("can：默认分层（系统 / owner / 无 grant）", () => {
  it.each(CAPABILITIES)("系统来源不需要 grant 就全放行：%s", (capability) => {
    expect(can(slot(), capability, SYSTEM_REQUESTER)).toBe(true);
  });

  it("任意 tiers 里含 system 的主体也全放行", () => {
    expect(can(slot(), "remove", { owner: "stranger", tiers: ["signed", "system"] })).toBe(true);
  });

  it.each(CAPABILITIES)("owner 对自己的 slot 全放行：%s", (capability) => {
    expect(can(slot(), capability, { owner: "ideas" })).toBe(true);
  });

  it("不是 owner 且没有 grant → 拒绝", () => {
    expect(can(slot(), "update", { owner: "stranger" })).toBe(false);
  });

  it("有 grant 但没有该能力 → 拒绝", () => {
    expect(can(granted({ update: ["role:editor"] }), "mount", { owner: "stranger" })).toBe(false);
  });

  it("grant 里该能力是空数组 → 拒绝", () => {
    expect(can(granted({ update: [] }), "update", { owner: "stranger" })).toBe(false);
  });
});

describe("can：grant token", () => {
  const cases: Array<[string, string[], Requester, boolean]> = [
    ["any 对任何主体放行", ["any"], { owner: "stranger" }, true],
    ["owner:<id> 命中", ["owner:alice"], { owner: "alice" }, true],
    ["owner:<id> 不命中", ["owner:alice"], { owner: "bob" }, false],
    ["role 命中", ["role:viewer"], { owner: "stranger", roles: ["viewer"] }, true],
    ["role 不命中", ["role:viewer"], { owner: "stranger", roles: ["editor"] }, false],
    ["role 没有 roles 列表", ["role:viewer"], { owner: "stranger" }, false],
    ["tier 命中", ["tier:signed"], { owner: "stranger", tiers: ["signed"] }, true],
    ["tier 不命中", ["tier:signed"], { owner: "stranger", tiers: ["user"] }, false],
    ["裸 token 当 owner id", ["alice"], { owner: "alice" }, true],
    ["裸 token 不命中", ["alice"], { owner: "bob" }, false],
    ["owner token 不放行其他 owner", ["owner"], { owner: "bob" }, false],
    ["role 空名无法识别", ["role:"], { owner: "stranger", roles: [""] }, false],
    ["未知前缀无法识别", ["scope:admin"], { owner: "stranger", roles: ["admin"] }, false],
  ];

  it.each(cases)("%s", (_name, tokens, requester, expected) => {
    expect(can(granted({ update: tokens }), "update", requester)).toBe(expected);
  });

  it("多个 token 里命中一个即可", () => {
    const target = granted({ update: ["role:admin", "alice"] });

    expect(can(target, "update", { owner: "alice" })).toBe(true);
    expect(can(target, "update", { owner: "bob", roles: ["admin"] })).toBe(true);
    expect(can(target, "update", { owner: "bob", roles: ["editor"] })).toBe(false);
  });
});

describe("checkPermission：ok / E-PERMISSION 诊断", () => {
  it("放行时返回 ok，不带诊断", () => {
    expect(
      checkPermission(granted({ update: ["role:editor"] }), "update", SYSTEM_REQUESTER),
    ).toEqual({ ok: true });
  });

  it("拒绝时诊断含 capability、slot id、requester.owner，现场带 owner / slot", () => {
    const result = checkPermission(granted({ mount: ["role:editor"] }), "update", {
      owner: "mallory",
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    const diagnostic = result.diagnostic;
    expect(diagnostic.severity).toBe("error");
    expect(diagnostic.code).toBe("E-PERMISSION");
    expect(diagnostic.message).toContain("update");
    expect(diagnostic.message).toContain("target");
    expect(diagnostic.message).toContain("mallory");
    expect(diagnostic.owner).toBe("ideas");
    expect(diagnostic.slot).toBe("target");
  });
});

// ---------------------------------------------------------------------------
// applyData 接入：真正会被写到的 slot 要 update 能力
// ---------------------------------------------------------------------------

function dataRoot(): SlotNode {
  return node({
    id: "root",
    owner: "ideas",
    layout: { flow: "column", capacity: "many" },
    children: [
      node({
        id: "feed",
        owner: "ideas",
        layout: { flow: "column", capacity: "many" },
        grant: wireGrant({ update: ["role:editor"] }),
        collection: {
          source: "ideas.feed",
          key: "id",
          select: "template",
          templates: {
            item: node({ id: "card", owner: "ideas", bind: { title: "title" } }),
          },
        },
      }),
      node({
        id: "title",
        owner: "ideas",
        in: [{ source: "ideas.title" }],
        bind: { text: "title" },
        grant: wireGrant({ update: ["role:editor"] }),
      }),
    ],
  });
}

const stranger: Requester = { owner: "stranger" };
const editor: Requester = { owner: "stranger", roles: ["editor"] };

const FEED_ITEMS = {
  kind: "data",
  owner: "ideas",
  source: "ideas.feed",
  revision: 1,
  items: [{ id: "1", template: "item", title: "第一" }],
};

const TITLE_VALUE = {
  kind: "data",
  owner: "ideas",
  source: "ideas.title",
  revision: 1,
  value: { title: "新" },
};

function emptyData(): DataState {
  return {};
}

describe("applyData 权限：集合消费者", () => {
  it("不传 requester 等于系统来源：照常实例化（默认行为不变）", () => {
    const result = applyData(stateOf(dataRoot(), 3), emptyData(), FEED_ITEMS);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.changed).toEqual(["feed"]);
  });

  it("受限 requester 对 collection slot 没有 update → E-PERMISSION", () => {
    const result = applyData(stateOf(dataRoot(), 3), emptyData(), FEED_ITEMS, {
      requester: stranger,
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["E-PERMISSION"]);
    expect(result.diagnostics[0]?.slot).toBe("feed");
  });

  it("拒绝时文档与数据都不变", () => {
    const state = stateOf(dataRoot(), 3);
    const snapshot = structuredClone(state);
    const data = emptyData();

    const result = applyData(state, data, FEED_ITEMS, { requester: stranger });

    expect(result.ok).toBe(false);
    expect(state).toEqual(snapshot);
    expect(data).toEqual({});
  });

  it("带 editor 角色放行，条目照常实例化", () => {
    const result = applyData(stateOf(dataRoot(), 3), emptyData(), FEED_ITEMS, {
      requester: editor,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const feed = result.document.root.children.find((child) => child.id === "feed");
    expect(feed?.children.map((child) => child.id)).toEqual(["feed#1"]);
    expect(feed?.children[0]?.props.title).toBe("第一");
  });

  it("revision 幂等 no-op 不做权限检查（没有写就不需要能力）", () => {
    const data: DataState = { "ideas.feed": { revision: 1, items: [] } };

    const result = applyData(stateOf(dataRoot(), 3), data, FEED_ITEMS, { requester: stranger });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.changed).toEqual([]);
    expect(result.data).toBe(data);
  });
});

describe("applyData 权限：标量消费者", () => {
  it("受限 requester 对会改 props 的消费者没有 update → E-PERMISSION，数据不写", () => {
    const state = stateOf(dataRoot(), 3);
    const data = emptyData();
    const snapshot = structuredClone(state);

    const result = applyData(state, data, TITLE_VALUE, { requester: stranger });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["E-PERMISSION"]);
    expect(result.diagnostics[0]?.slot).toBe("title");
    expect(state).toEqual(snapshot);
    expect(data).toEqual({});
  });

  it("带 editor 角色放行，props 被绑定", () => {
    const result = applyData(stateOf(dataRoot(), 3), emptyData(), TITLE_VALUE, {
      requester: editor,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.changed).toEqual(["title"]);
    expect(result.document.root.children[1]?.props.text).toBe("新");
  });

  it("消费者存在但 props 不会变：不算被写，受限 requester 也放行", () => {
    const payload = {
      kind: "data",
      owner: "ideas",
      source: "ideas.title",
      revision: 1,
      value: { other: "解析不到" },
    };

    const result = applyData(stateOf(dataRoot(), 3), emptyData(), payload, {
      requester: stranger,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.changed).toEqual([]);
    expect(result.data["ideas.title"]?.revision).toBe(1);
  });

  it("没有消费者时只写数据、不需要能力", () => {
    const payload = {
      kind: "data",
      owner: "ideas",
      source: "ideas.orphan",
      revision: 1,
      value: 42,
    };

    const result = applyData(stateOf(dataRoot(), 3), emptyData(), payload, {
      requester: stranger,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.changed).toEqual([]);
    expect(result.data["ideas.orphan"]?.value).toBe(42);
  });
});

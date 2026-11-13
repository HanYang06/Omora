import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { SlotNode } from "../core/document";
import { DocumentIndex } from "./document";
import { hydrateSession, type HydrateResult } from "./hydrate";
import { createSession, type SessionState } from "./session";

/**
 * 共享 fixture（不许改）：整份 Slot 文档（version 3，active page.ideas）。
 * ideas.feed 带 collection（source = ideas.feed，模板 item 把 title / meta 绑定），
 * data 里只有一条 item id = 42。
 */
const DOCUMENT_FIXTURE_PATH = fileURLToPath(
  new URL("../../../sdk/tests/fixtures/document.json", import.meta.url),
);

function recordOf(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("应该是对象: " + JSON.stringify(value));
  }
  return value as Record<string, unknown>;
}

function arrayOf(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error("应该是数组: " + JSON.stringify(value));
  }
  return value;
}

function readDocumentFixture(): Record<string, unknown> {
  return recordOf(JSON.parse(readFileSync(DOCUMENT_FIXTURE_PATH, "utf8")));
}

function sessionOf(value: unknown): SessionState {
  const result = createSession(value);
  if (!result.ok) {
    throw new Error("测试文档应合法: " + JSON.stringify(result.diagnostics));
  }
  return result.session;
}

function sessionFromFixture(): SessionState {
  return sessionOf(readDocumentFixture());
}

function hydrated(result: HydrateResult): Extract<HydrateResult, { ok: true }> {
  if (!result.ok) {
    throw new Error("水合应成功: " + JSON.stringify(result.diagnostics));
  }
  return result;
}

/** 只换数据文档（source → 数据投影），其余会话状态原样。 */
function withData(session: SessionState, data: Record<string, unknown>): SessionState {
  return { ...session, data };
}

/** 按 id 找 live 节点（索引会包含模板，但这里只查已知的 live id）。 */
function slotOf(session: SessionState, id: string): SlotNode {
  const slot = DocumentIndex.build(session.document.root).get(id);
  if (slot === undefined) {
    throw new Error("找不到 slot: " + id);
  }
  return slot;
}

function childIds(session: SessionState, slotId: string): string[] {
  return slotOf(session, slotId).children.map((child) => child.id);
}

function childTitles(session: SessionState, slotId: string): unknown[] {
  return slotOf(session, slotId).children.map((child) => child.props.title);
}

function onlyChild(session: SessionState, slotId: string): SlotNode {
  const children = slotOf(session, slotId).children;
  const child = children[0];
  if (children.length !== 1 || child === undefined) {
    throw new Error("slot " + slotId + " 应该正好有一个实例，实际 " + String(children.length));
  }
  return child;
}

describe("hydrateSession", () => {
  it("从全量文档 data 物化集合子节点并保留会话其余状态", () => {
    const session = sessionFromFixture();
    const beforeFeed = slotOf(session, "ideas.feed");
    const beforeTemplate = beforeFeed.collection?.templates["item"];

    const result = hydrated(hydrateSession(session));

    // 集合 slot 被整槽物化：实例 id 由 slot id + 数据 key 派生，bind 进了 props。
    expect(result.changed).toEqual(["ideas.feed"]);
    expect(result.diagnostics).toEqual([]);
    expect(childIds(result.session, "ideas.feed")).toEqual(["ideas.feed#42"]);
    const instance = onlyChild(result.session, "ideas.feed");
    expect(instance.kind).toBe("ideas:card");
    expect(instance.props).toMatchObject({ title: "买牛奶", meta: "刚刚" });

    // 模板表不展开、不被改写：仍原样挂在 collection 上，live children 里没有模板节点。
    const afterFeed = slotOf(result.session, "ideas.feed");
    expect(afterFeed.collection?.templates["item"]).toBe(beforeTemplate);
    expect(afterFeed.collection?.templates["item"]).toBeDefined();
    expect(childIds(result.session, "ideas.feed")).not.toContain("tpl.ideas.item");

    // 只有根到这棵子树的路径换了引用；nav 兄弟、版本、pages / active / data 都不动。
    expect(result.session).not.toBe(session);
    expect(result.session.document.version).toBe(3);
    expect(result.session.pages).toBe(session.pages);
    expect(result.session.active).toBe("page.ideas");
    expect(result.session.data).toBe(session.data);
    expect(slotOf(result.session, "dendro.window.nav")).toBe(slotOf(session, "dendro.window.nav"));
    expect(slotOf(result.session, "page.ideas")).not.toBe(slotOf(session, "page.ideas"));

    // 入参不被改写：原会话的 feed 还是空的。
    expect(childIds(session, "ideas.feed")).toEqual([]);
    expect(slotOf(session, "ideas.feed")).toBe(beforeFeed);
  });

  it("数据源缺失或没有 items 时保持原 children 不动", () => {
    const session = sessionFromFixture();

    // 整份 data 空：根树引用不变，连会话对象都复用。
    const emptied = withData(session, {});
    const empty = hydrated(hydrateSession(emptied));
    expect(empty.session).toBe(emptied);
    expect(empty.session.document.root).toBe(session.document.root);
    expect(empty.changed).toEqual([]);
    expect(empty.diagnostics).toEqual([]);

    // 投影存在但没有 items：数据还没到，不动。
    const noItems = hydrated(hydrateSession(withData(session, { "ideas.feed": { revision: 9 } })));
    expect(noItems.session.document.root).toBe(session.document.root);
    expect(noItems.changed).toEqual([]);
    expect(noItems.diagnostics).toEqual([]);

    // 没有被任何集合消费的 source：只存数据，不动树。
    const unrelated = hydrated(
      hydrateSession(withData(session, { "session.status": { revision: 1, value: true } })),
    );
    expect(unrelated.session.document.root).toBe(session.document.root);
    expect(unrelated.changed).toEqual([]);

    // 已水合过、随后数据源又缺失：保留原实例子树（引用都不变）。
    const preHydrated = hydrated(hydrateSession(session)).session;
    const kept = hydrated(hydrateSession(withData(preHydrated, {})));
    expect(kept.session.document.root).toBe(preHydrated.document.root);
    expect(childIds(kept.session, "ideas.feed")).toEqual(["ideas.feed#42"]);
    expect(onlyChild(kept.session, "ideas.feed")).toBe(onlyChild(preHydrated, "ideas.feed"));
  });

  it("items 是空数组时清空集合 children 并记 changed", () => {
    const session = sessionFromFixture();
    const result = hydrated(
      hydrateSession(withData(session, { "ideas.feed": { revision: 1, items: [] } })),
    );

    expect(result.changed).toEqual(["ideas.feed"]);
    expect(childIds(result.session, "ideas.feed")).toEqual([]);
    expect(result.session.document.root).not.toBe(session.document.root);
    expect(result.session.document.version).toBe(3);
  });

  it("数据投影形状非法时记 E-PAYLOAD 并保持树原样", () => {
    const session = sessionFromFixture();
    const cases: { label: string; data: Record<string, unknown> }[] = [
      { label: "投影不是对象", data: { "ideas.feed": "oops" } },
      { label: "投影是数组", data: { "ideas.feed": [] } },
      { label: "items 不是数组", data: { "ideas.feed": { revision: 2, items: "oops" } } },
    ];

    for (const { label, data } of cases) {
      const result = hydrated(hydrateSession(withData(session, data)));
      expect(result.session.document.root, label).toBe(session.document.root);
      expect(result.changed, label).toEqual([]);
      expect(result.diagnostics, label).toHaveLength(1);
      expect(result.diagnostics[0]?.code, label).toBe("E-PAYLOAD");
      expect(result.diagnostics[0]?.slot, label).toBe("ideas.feed");
      expect(result.diagnostics[0]?.path, label).toBe('$.data["ideas.feed"]');
    }
  });

  it("坏条目只丢自己，集合原语诊断原样带出且仍 ok", () => {
    const session = sessionFromFixture();
    const items: unknown[] = [
      { id: "42", template: "item", title: "买牛奶", meta: "刚刚" },
      { id: "43", template: "missing" },
      { id: "44" },
      "not-an-object",
      { template: "item", title: "缺 key" },
      { id: "42", template: "item", title: "重复 key" },
    ];

    const result = hydrated(
      hydrateSession(withData(session, { "ideas.feed": { revision: 6, items } })),
    );

    expect(result.changed).toEqual(["ideas.feed"]);
    expect(childIds(result.session, "ideas.feed")).toEqual(["ideas.feed#42"]);
    expect(onlyChild(result.session, "ideas.feed").props.title).toBe("买牛奶");
    const codes = result.diagnostics.map((diagnostic) => diagnostic.code);
    expect(codes.filter((code) => code === "E-TEMPLATE")).toHaveLength(4);
    expect(codes.filter((code) => code === "E-ID-DUPLICATE")).toHaveLength(1);
  });

  it("同输入重复水合值幂等（id / 层级 / props 一致）", () => {
    const session = sessionFromFixture();
    const first = hydrated(hydrateSession(session));
    const second = hydrated(hydrateSession(session));

    expect(childIds(second.session, "ideas.feed")).toEqual(["ideas.feed#42"]);
    expect(childIds(second.session, "ideas.feed")).toEqual(childIds(first.session, "ideas.feed"));
    expect(childTitles(second.session, "ideas.feed")).toEqual(["买牛奶"]);

    // 拿已经水合过的会话再水合：值不变，实例 id / props 稳定。
    const again = hydrated(hydrateSession(first.session));
    expect(again.changed).toEqual(["ideas.feed"]);
    expect(childIds(again.session, "ideas.feed")).toEqual(["ideas.feed#42"]);
    expect(onlyChild(again.session, "ideas.feed").props).toMatchObject({
      title: "买牛奶",
      meta: "刚刚",
    });
    // 入参不被改写。
    expect(childIds(session, "ideas.feed")).toEqual([]);
  });

  it("物化文档里每个消费同一 source 的集合 slot，changed 按文档序", () => {
    const document = readDocumentFixture();
    const root = recordOf(document.document);
    const pageSlot = recordOf(arrayOf(root.children)[1]);
    const page = recordOf(arrayOf(pageSlot.children)[0]);
    const feed = recordOf(arrayOf(page.children)[0]);
    // 第二个集合 slot 消费同一 source；模板 id 必须全局唯一，所以改掉模板 id。
    const sidebar = recordOf(structuredClone(feed));
    sidebar.id = "ideas.sidebar";
    const sidebarCollection = recordOf(sidebar.collection);
    const sidebarTemplates = recordOf(sidebarCollection.templates);
    sidebarTemplates.item = { ...recordOf(sidebarTemplates.item), id: "tpl.ideas.sidebar" };
    arrayOf(page.children).push(sidebar);

    const session = sessionOf(document);
    const result = hydrated(hydrateSession(session));

    expect(result.changed).toEqual(["ideas.feed", "ideas.sidebar"]);
    expect(childIds(result.session, "ideas.feed")).toEqual(["ideas.feed#42"]);
    expect(childIds(result.session, "ideas.sidebar")).toEqual(["ideas.sidebar#42"]);
    expect(childTitles(result.session, "ideas.sidebar")).toEqual(["买牛奶"]);
    expect(result.diagnostics).toEqual([]);
  });

  it("session.data 不是对象时失败返回 E-PAYLOAD 且不抛", () => {
    const session = sessionFromFixture();
    const broken: SessionState = {
      ...session,
      data: 42 as unknown as Record<string, unknown>,
    };

    const result = hydrateSession(broken);
    if (result.ok) {
      throw new Error("session.data 不是对象时应失败");
    }
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.code).toBe("E-PAYLOAD");
    expect(result.diagnostics[0]?.path).toBe("$.data");
    expect(childIds(session, "ideas.feed")).toEqual([]);
  });
});

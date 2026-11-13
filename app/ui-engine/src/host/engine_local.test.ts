import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { SlotNode } from "../contract/document";
import { DocumentIndex } from "../engine/document/document";
import {
  createEngine,
  type EngineApplyResult,
  type EngineOptions,
  type EngineRuntime,
} from "./engine";

/**
 * EngineRuntime.applyLocalTrees（S4 全量 local-trees 更新）：链接器重链窗口骨架 →
 * 换根树（版本 +1）→ 用当前 data 重新水合 → 指标 / 审计 / 通知。
 *
 * 单独成文件（engine.test.ts 已接近测试行数预算）。共享 fixture 不许改。
 * 共享 local-trees.json 的 ideas.feed 用 `in` 声明数据源、卡片由两棵局部树直接贡献
 * （没有 collection），所以那次重组里水合对 feed 是 no-op；水合接线由本文件用一棵带
 * collection 的局部树钉住。
 */
const DOCUMENT_FIXTURE_PATH = fileURLToPath(
  new URL("../../../sdk/tests/fixtures/document.json", import.meta.url),
);
const LOCAL_TREES_FIXTURE_PATH = fileURLToPath(
  new URL("../../../sdk/tests/fixtures/local-trees.json", import.meta.url),
);

function recordOf(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("应该是对象: " + JSON.stringify(value));
  }
  return value as Record<string, unknown>;
}

function readFixture(path: string): Record<string, unknown> {
  return recordOf(JSON.parse(readFileSync(path, "utf8")));
}

function engineOf(value: unknown, options: EngineOptions = {}): EngineRuntime {
  const created = createEngine(value, options);
  if (!created.ok) {
    throw new Error("测试文档应能建引擎: " + JSON.stringify(created.diagnostics));
  }
  return created.engine;
}

function applied(result: EngineApplyResult) {
  if (!result.ok) {
    throw new Error("apply 应成功: " + JSON.stringify(result.diagnostics));
  }
  return result;
}

function failed(result: EngineApplyResult) {
  if (result.ok) {
    throw new Error("apply 应失败");
  }
  return result.diagnostics;
}

function nodeById(engine: EngineRuntime, id: string): SlotNode | undefined {
  return DocumentIndex.build(engine.session.document.root).get(id);
}

/**
 * 一棵把集合 slot 交给数据的局部树：page 里声明 ideas.feed 的 collection
 * （模板 bind item.title / item.meta），链接后水合会按当前 data 物化卡片。
 */
function collectionPayload(): Record<string, unknown> {
  return {
    kind: "local-trees",
    seq: 1,
    trees: [
      {
        owner: "ideas",
        mountAt: "dendro.window.page",
        order: 10,
        seq: 1,
        root: {
          id: "page.ideas",
          kind: "dendro:page",
          owner: "ideas",
          props: { label: "灵感" },
          children: [
            {
              id: "ideas.feed",
              kind: "dendro:slot",
              owner: "ideas",
              props: {},
              layout: { flow: "column", capacity: "many" },
              collection: {
                source: "ideas.feed",
                key: "id",
                select: "template",
                templates: {
                  item: {
                    id: "tpl.ideas.item",
                    kind: "ideas:card",
                    owner: "ideas",
                    props: {},
                    bind: { title: "item.title", meta: "item.meta" },
                    children: [],
                  },
                },
              },
              children: [],
            },
          ],
        },
      },
    ],
  };
}

/** ideas.feed 的全量集合数据：一条 key=42 的条目（延续 document.json 的 revision 5）。 */
function itemsPayload(revision: number, title: string): Record<string, unknown> {
  return {
    kind: "data",
    owner: "ideas",
    source: "ideas.feed",
    revision,
    items: [{ id: "42", template: "item", title }],
  };
}

/** 形状合法但落点不存在的局部树：链接期 E-TARGET-MISSING。 */
function missingTargetPayload(): Record<string, unknown> {
  return {
    kind: "local-trees",
    seq: 1,
    trees: [
      {
        owner: "ghost",
        mountAt: "dendro.window.nope",
        order: 1,
        seq: 1,
        root: {
          id: "ghost.node",
          kind: "dendro:text",
          owner: "ghost",
          props: { text: "hi" },
          children: [],
        },
      },
    ],
  };
}

describe("applyLocalTrees：共享 fixture 全量重组", () => {
  it("版本 +1、根是链接结果、只换树、指标 / 审计 / 通知到位", () => {
    const engine = engineOf(readFixture(DOCUMENT_FIXTURE_PATH));
    const before = engine.session;
    const events: { version: number; changed: readonly string[] }[] = [];
    engine.onChange((next, changed) => events.push({ version: next.document.version, changed }));

    const result = applied(engine.applyLocalTrees(readFixture(LOCAL_TREES_FIXTURE_PATH)));

    // 整棵树换成「窗口骨架 + 四棵局部树」的链接结果；版本 +1，changed 是新根 id。
    expect(result.changed).toEqual(["dendro.window"]);
    expect(result.session).toBe(engine.session);
    expect(engine.session.document.version).toBe(4);
    expect(engine.session.document.root.id).toBe("dendro.window");
    expect(engine.session.document.root.children.map((child) => child.id)).toEqual([
      "dendro.window.nav",
      "dendro.window.page",
    ]);
    expect(nodeById(engine, "dendro.window.nav")?.children.map((child) => child.id)).toEqual([
      "nav.ideas",
    ]);
    expect(nodeById(engine, "dendro.window.page")?.children.map((child) => child.id)).toEqual([
      "page.ideas",
    ]);
    // 卡片来自两棵局部树（feed 只声明 in，没有 collection），水合对它是 no-op。
    expect(nodeById(engine, "ideas.feed")?.children.map((child) => child.id)).toEqual([
      "ideas.feed#42",
      "ideas.feed#7",
    ]);
    expect(nodeById(engine, "ideas.feed")?.collection).toBeUndefined();
    expect(nodeById(engine, "ideas.feed#42")?.props).toEqual({ title: "买牛奶", meta: "刚刚" });

    // 只换树：页面侧表 / active / data 保留（payload 不带页面侧表）。
    expect(engine.session.pages).toBe(before.pages);
    expect(engine.session.active).toBe("page.ideas");
    expect(engine.session.data).toBe(before.data);
    expect(engine.metrics).toMatchObject({
      version: 4,
      localTreeUpdates: 1,
      notifications: 1,
      rejections: 0,
      diagnostics: 0,
      lastDiagnostics: [],
    });
    expect(engine.audit.entries()).toEqual([{ seq: 1, kind: "apply", changed: 1 }]);
    expect(events).toEqual([{ version: 4, changed: ["dendro.window"] }]);
  });
});

describe("applyLocalTrees：水合接线", () => {
  it("带 collection 的局部树按当前 data 物化卡片，之后 applyData 照常更新", () => {
    const engine = engineOf(readFixture(DOCUMENT_FIXTURE_PATH));

    applied(engine.applyLocalTrees(collectionPayload()));

    // 链接结果里的空 feed slot 在换根树后被当前 data（document.json 的 items）水合成卡片。
    expect(engine.session.document.version).toBe(4);
    expect(nodeById(engine, "ideas.feed")?.children.map((child) => child.id)).toEqual([
      "ideas.feed#42",
    ]);
    expect(nodeById(engine, "ideas.feed#42")?.props).toEqual({ title: "买牛奶", meta: "刚刚" });
    expect(engine.metrics).toMatchObject({
      localTreeUpdates: 1,
      dataUpdates: 0,
      rejections: 0,
      diagnostics: 0,
    });

    // 重链后的树仍带 collection：数据更新找得到消费者并更新卡片 props。
    const updated = applied(engine.applyData(itemsPayload(6, "改后的标题")));

    expect(updated.changed).toEqual(["ideas.feed"]);
    expect(nodeById(engine, "ideas.feed#42")?.props.title).toBe("改后的标题");
    expect(engine.metrics).toMatchObject({ localTreeUpdates: 1, dataUpdates: 1, rejections: 0 });
  });
});

describe("applyLocalTrees：失败与原状态", () => {
  it("非法 payload：E-PAYLOAD 拒绝、会话不变、rejections / 诊断 / 审计、不通知", () => {
    const engine = engineOf(readFixture(DOCUMENT_FIXTURE_PATH));
    const before = structuredClone(engine.session);
    let notified = 0;
    engine.onChange(() => {
      notified += 1;
    });

    const diagnostics = failed(engine.applyLocalTrees({ kind: "local-trees", seq: 1, trees: {} }));

    expect(diagnostics.every((diagnostic) => diagnostic.code === "E-PAYLOAD")).toBe(true);
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(engine.session).toEqual(before);
    expect(engine.metrics).toMatchObject({
      version: 3,
      localTreeUpdates: 0,
      rejections: 1,
      diagnostics: diagnostics.length,
      notifications: 0,
    });
    expect(engine.metrics.lastDiagnostics).toEqual(diagnostics);
    expect(engine.audit.entries()).toHaveLength(1);
    expect(engine.audit.entries()[0]).toMatchObject({ seq: 1, kind: "reject", changed: 0 });
    expect(notified).toBe(0);
  });

  it("链接失败（落点不存在）：E-TARGET-MISSING 拒绝、会话不变", () => {
    const engine = engineOf(readFixture(DOCUMENT_FIXTURE_PATH));
    const before = structuredClone(engine.session);

    const diagnostics = failed(engine.applyLocalTrees(missingTargetPayload()));

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["E-TARGET-MISSING"]);
    expect(engine.session).toEqual(before);
    expect(engine.metrics).toMatchObject({ localTreeUpdates: 0, rejections: 1 });
    expect(engine.audit.entries()[0]).toMatchObject({ kind: "reject", code: "E-TARGET-MISSING" });
  });

  it("受限 requester：链接期 E-PERMISSION 拒绝，审计记 reject + deny", () => {
    const engine = engineOf(readFixture(DOCUMENT_FIXTURE_PATH), {
      requester: { owner: "outsider" },
    });
    const before = structuredClone(engine.session);

    const diagnostics = failed(engine.applyLocalTrees(readFixture(LOCAL_TREES_FIXTURE_PATH)));

    expect(diagnostics.every((diagnostic) => diagnostic.code === "E-PERMISSION")).toBe(true);
    expect(diagnostics[0]?.message).toContain("mount");
    expect(engine.session).toEqual(before);
    expect(engine.metrics).toMatchObject({
      version: 3,
      localTreeUpdates: 0,
      rejections: 1,
      notifications: 0,
    });
    const entries = engine.audit.entries();
    expect(entries[0]).toMatchObject({ seq: 1, kind: "reject", code: "E-PERMISSION" });
    expect(entries.slice(1).length).toBeGreaterThan(0);
    expect(entries.slice(1).every((entry) => entry.kind === "deny")).toBe(true);
  });

  it("dispose 之后拒绝：E-PAYLOAD、会话与指标 / 审计都不再变", () => {
    const engine = engineOf(readFixture(DOCUMENT_FIXTURE_PATH));
    engine.dispose();
    const before = structuredClone(engine.session);
    const metricsBefore = engine.metrics;

    const diagnostics = failed(engine.applyLocalTrees(readFixture(LOCAL_TREES_FIXTURE_PATH)));

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["E-PAYLOAD"]);
    expect(diagnostics[0]?.message).toContain("dispose");
    expect(engine.session).toEqual(before);
    expect(engine.metrics).toEqual(metricsBefore);
    expect(engine.audit.entries()).toEqual([]);
  });
});

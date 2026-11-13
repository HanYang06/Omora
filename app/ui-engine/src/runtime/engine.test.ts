import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DocumentIndex } from "./document";
import {
  createEngine,
  type EngineApplyResult,
  type EngineOptions,
  type EngineRuntime,
} from "./engine";
import { LifecycleLedger } from "./lifecycle";
import { RuntimeMetrics } from "./metrics";

/**
 * 共享 fixture（不许改）：document.json 是 version 3 的整份 v2 文档（active page.ideas，
 * ideas.feed 集合 + 一条数据）；route.json 是 base 3 → document 4、仅一条 route 的批量。
 */
const DOCUMENT_FIXTURE_PATH = fileURLToPath(
  new URL("../../../sdk/tests/fixtures/document.json", import.meta.url),
);
const ROUTE_FIXTURE_PATH = fileURLToPath(
  new URL("../../../sdk/tests/fixtures/route.json", import.meta.url),
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

function createFailed(value: unknown) {
  const created = createEngine(value);
  if (created.ok) {
    throw new Error("文档应建引擎失败");
  }
  return created.diagnostics;
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

function nodeById(engine: EngineRuntime, id: string) {
  return DocumentIndex.build(engine.session.document.root).get(id);
}

function feedOf(engine: EngineRuntime) {
  return nodeById(engine, "ideas.feed");
}

/** ideas.feed 的全量集合数据：一条 key=42 的条目。 */
function itemsPayload(revision: number, title: string): Record<string, unknown> {
  return {
    kind: "data",
    owner: "ideas",
    source: "ideas.feed",
    revision,
    items: [{ id: "42", template: "item", title, meta: "刚刚" }],
  };
}

/** 全量替换用的另一份文档：树 / pages / active / data 全不同。 */
function replacementDocument(version: number): Record<string, unknown> {
  return {
    schema: "dendro.ui/1",
    document: {
      id: "dendro.window",
      kind: "dendro:window",
      owner: "dendro",
      props: { replaced: true },
      children: [],
    },
    pages: [{ id: "page.detail", label: "详情", route: "/ideas/:id", owner: "ideas" }],
    active: "page.detail",
    data: { "ideas.detail": { revision: 2, value: { id: "42" } } },
    version,
  };
}

describe("createEngine：接管共享文档并水合", () => {
  it("共享 document.json：version 3 / active page.ideas，feed 已水合成卡片实例，指标全零", () => {
    const engine = engineOf(readFixture(DOCUMENT_FIXTURE_PATH));

    expect(engine.session.document.version).toBe(3);
    expect(engine.session.active).toBe("page.ideas");
    expect(feedOf(engine)?.children.map((child) => child.id)).toEqual(["ideas.feed#42"]);
    expect(nodeById(engine, "ideas.feed#42")?.props).toEqual({ title: "买牛奶", meta: "刚刚" });
    expect(engine.metrics).toEqual({
      version: 3,
      opsBatches: 0,
      opsCount: 0,
      dataUpdates: 0,
      fullUpdates: 0,
      localTreeUpdates: 0,
      rejections: 0,
      diagnostics: 0,
      lastDiagnostics: [],
      notifications: 0,
      renders: 0,
      nodesCreated: 0,
      nodesUpdated: 0,
      nodesReused: 0,
      nodesRemoved: 0,
      lastRender: { created: 0, updated: 0, reused: 0, removed: 0 },
      lastApplyMs: 0,
      totalApplyMs: 0,
      maxApplyMs: 0,
    });
  });

  it("文档非法：返回诊断、不建引擎", () => {
    const badSchema = readFixture(DOCUMENT_FIXTURE_PATH);
    badSchema.schema = "dendro.ui/3";
    expect(createFailed(badSchema).map((diagnostic) => diagnostic.code)).toEqual(["E-PAYLOAD"]);

    const badVersion = readFixture(DOCUMENT_FIXTURE_PATH);
    badVersion.version = 0;
    expect(createFailed(badVersion).map((diagnostic) => diagnostic.code)).toEqual(["E-VERSION"]);
  });

  it("建引擎不改写入参：线上文档原样", () => {
    const value = readFixture(DOCUMENT_FIXTURE_PATH);
    const snapshot = structuredClone(value);

    engineOf(value);

    expect(value).toEqual(snapshot);
  });

  it("水合条目级诊断：建引擎成功、坏条目被丢、诊断记进指标", () => {
    const value = readFixture(DOCUMENT_FIXTURE_PATH);
    recordOf(value.data)["ideas.feed"] = { revision: 5, items: [{ title: "没有 key" }] };

    const engine = engineOf(value);

    expect(feedOf(engine)?.children).toEqual([]);
    expect(engine.metrics.diagnostics).toBe(1);
    expect(engine.metrics.lastDiagnostics[0]?.code).toBe("E-TEMPLATE");
  });
});

describe("applyData：数据更新", () => {
  it("更新条目字段：会话数据、集合实例 props、dataUpdates、通知都到位", () => {
    const engine = engineOf(readFixture(DOCUMENT_FIXTURE_PATH));
    const events: { version: number; changed: readonly string[] }[] = [];
    engine.onChange((next, changed) => events.push({ version: next.document.version, changed }));

    const result = applied(engine.applyData(itemsPayload(6, "买牛奶（改）")));

    expect(result.changed).toEqual(["ideas.feed"]);
    expect(result.session).toBe(engine.session);
    expect(engine.session.data["ideas.feed"]).toEqual({
      revision: 6,
      items: [{ id: "42", template: "item", title: "买牛奶（改）", meta: "刚刚" }],
    });
    expect(nodeById(engine, "ideas.feed#42")?.props).toEqual({
      title: "买牛奶（改）",
      meta: "刚刚",
    });
    expect(engine.metrics).toMatchObject({
      version: 3,
      dataUpdates: 1,
      rejections: 0,
      notifications: 1,
    });
    expect(engine.metrics.lastDiagnostics).toEqual([]);
    expect(events).toEqual([{ version: 3, changed: ["ideas.feed"] }]);
  });

  it("非法信封：拒绝、会话不变、rejections 与诊断、不通知", () => {
    const engine = engineOf(readFixture(DOCUMENT_FIXTURE_PATH));
    const before = structuredClone(engine.session);
    let notified = 0;
    engine.onChange(() => {
      notified += 1;
    });

    const diagnostics = failed(engine.applyData({ kind: "data", source: "x" }));

    expect(diagnostics.every((diagnostic) => diagnostic.code === "E-PAYLOAD")).toBe(true);
    expect(engine.session).toEqual(before);
    expect(engine.metrics).toMatchObject({
      dataUpdates: 0,
      rejections: 1,
      diagnostics: diagnostics.length,
      notifications: 0,
    });
    expect(engine.metrics.lastDiagnostics).toEqual(diagnostics);
    expect(notified).toBe(0);
  });

  it("revision 幂等重放：成功但 changed 空、数据不变，仍按一次成功 apply 计数并通知", () => {
    const engine = engineOf(readFixture(DOCUMENT_FIXTURE_PATH));
    applied(engine.applyData(itemsPayload(6, "新标题")));
    const after = structuredClone(engine.session);
    let notified = 0;
    engine.onChange(() => {
      notified += 1;
    });

    const result = applied(engine.applyData(itemsPayload(6, "旧标题")));

    expect(result.changed).toEqual([]);
    expect(engine.session).toEqual(after);
    expect(nodeById(engine, "ideas.feed#42")?.props.title).toBe("新标题");
    expect(engine.metrics.dataUpdates).toBe(2);
    expect(engine.metrics.notifications).toBe(1);
    expect(notified).toBe(1);
  });
});

describe("applyOps：批量树 op 与 route", () => {
  it("共享 route.json：版本 3→4、active 不变、changed 空、按一个批量计数", () => {
    const engine = engineOf(readFixture(DOCUMENT_FIXTURE_PATH));
    const versions: number[] = [];
    engine.onChange((next) => versions.push(next.document.version));

    const result = applied(engine.applyOps(readFixture(ROUTE_FIXTURE_PATH)));

    expect(result.changed).toEqual([]);
    expect(engine.session.document.version).toBe(4);
    expect(engine.session.active).toBe("page.ideas");
    expect(engine.metrics).toMatchObject({
      version: 4,
      opsBatches: 1,
      opsCount: 1,
      notifications: 1,
      rejections: 0,
    });
    expect(versions).toEqual([4]);
  });

  it("base 与当前版本不匹配：E-VERSION 拒绝、会话不变、rejections、不通知", () => {
    const engine = engineOf(readFixture(DOCUMENT_FIXTURE_PATH));
    applied(engine.applyOps(readFixture(ROUTE_FIXTURE_PATH))); // 3 → 4
    const before = structuredClone(engine.session);
    let notified = 0;
    engine.onChange(() => {
      notified += 1;
    });

    const diagnostics = failed(engine.applyOps(readFixture(ROUTE_FIXTURE_PATH)));

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["E-VERSION"]);
    expect(engine.session).toEqual(before);
    expect(engine.metrics).toMatchObject({
      opsBatches: 1,
      opsCount: 1,
      rejections: 1,
      notifications: 0,
    });
    expect(notified).toBe(0);
  });

  it("混批：opsCount 含 route、changed 只含树 op", () => {
    const engine = engineOf(readFixture(DOCUMENT_FIXTURE_PATH));

    const result = applied(
      engine.applyOps({
        kind: "ops",
        document: 4,
        base: 3,
        seq: 1,
        ops: [
          { op: "update", id: "page.ideas", props: { label: "灵感改" } },
          { op: "route", page: "page.ideas" },
        ],
      }),
    );

    expect(result.changed).toEqual(["page.ideas"]);
    expect(nodeById(engine, "page.ideas")?.props.label).toBe("灵感改");
    expect(engine.metrics).toMatchObject({ opsBatches: 1, opsCount: 2, version: 4 });
  });
});

describe("applyFull：全量替换", () => {
  it("整份会话替换：changed 是新根 id、pages / active / data 全换，fullUpdates 与通知", () => {
    const engine = engineOf(readFixture(DOCUMENT_FIXTURE_PATH));
    const events: string[][] = [];
    engine.onChange((_next, changed) => events.push([...changed]));

    const result = applied(engine.applyFull(replacementDocument(4)));

    expect(result.changed).toEqual(["dendro.window"]);
    expect(engine.session.document.version).toBe(4);
    expect(engine.session.active).toBe("page.detail");
    expect(engine.session.pages.map((page) => page.id)).toEqual(["page.detail"]);
    expect(Object.keys(engine.session.data)).toEqual(["ideas.detail"]);
    expect(engine.metrics).toMatchObject({
      version: 4,
      fullUpdates: 1,
      notifications: 1,
      rejections: 0,
    });
    expect(events).toEqual([["dendro.window"]]);
  });

  it("替换后重新水合集合实例", () => {
    const engine = engineOf(readFixture(DOCUMENT_FIXTURE_PATH));
    const full = structuredClone(readFixture(DOCUMENT_FIXTURE_PATH));
    full.version = 5;
    full.data = {
      "ideas.feed": {
        revision: 9,
        items: [{ id: "42", template: "item", title: "全量标题", meta: "刚刚" }],
      },
    };

    applied(engine.applyFull(full));

    expect(engine.session.document.version).toBe(5);
    expect(feedOf(engine)?.children.map((child) => child.id)).toEqual(["ideas.feed#42"]);
    expect(nodeById(engine, "ideas.feed#42")?.props.title).toBe("全量标题");
    expect(engine.metrics.fullUpdates).toBe(1);
  });

  it("旧版本：E-VERSION 拒绝、会话不变、rejections、不通知", () => {
    const engine = engineOf(readFixture(DOCUMENT_FIXTURE_PATH)); // 版本 3
    const before = structuredClone(engine.session);
    let notified = 0;
    engine.onChange(() => {
      notified += 1;
    });

    const diagnostics = failed(engine.applyFull(replacementDocument(2)));

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["E-VERSION"]);
    expect(engine.session).toEqual(before);
    expect(engine.metrics).toMatchObject({
      fullUpdates: 0,
      rejections: 1,
      notifications: 0,
    });
    expect(notified).toBe(0);
  });
});

describe("onChange：监听与错误隔离", () => {
  it("取消订阅后不再收到通知", () => {
    const engine = engineOf(readFixture(DOCUMENT_FIXTURE_PATH));
    const first: number[] = [];
    const second: number[] = [];
    const off = engine.onChange((next) => first.push(next.document.version));
    engine.onChange((next) => second.push(next.document.version));

    off();
    applied(engine.applyOps(readFixture(ROUTE_FIXTURE_PATH)));

    expect(first).toEqual([]);
    expect(second).toEqual([4]);
    expect(engine.metrics.notifications).toBe(1);
  });

  it("单个监听者抛错被隔离：其余监听者照常收到、apply 仍成功", () => {
    const engine = engineOf(readFixture(DOCUMENT_FIXTURE_PATH));
    const seen: number[] = [];
    engine.onChange(() => {
      throw new Error("监听失败");
    });
    engine.onChange((next) => seen.push(next.document.version));

    const result = applied(engine.applyOps(readFixture(ROUTE_FIXTURE_PATH)));

    expect(result.changed).toEqual([]);
    expect(engine.session.document.version).toBe(4);
    expect(seen).toEqual([4]);
    expect(engine.metrics.notifications).toBe(2);
  });
});

describe("registerCleanup 与 dispose：逆序撤销、失败隔离、幂等与收口", () => {
  it("清理按登记逆序执行、单个抛错隔离并汇总进 errors、dispose 幂等", () => {
    const engine = engineOf(readFixture(DOCUMENT_FIXTURE_PATH));
    const order: string[] = [];
    const boom = new Error("第二个登记的清理失败");
    engine.registerCleanup(() => order.push("first"));
    engine.registerCleanup(() => {
      order.push("second");
      throw boom;
    });
    engine.registerCleanup(() => order.push("third"));

    const report = engine.dispose();

    expect(order).toEqual(["third", "second", "first"]);
    expect(report.disposed).toBe(3);
    expect(report.errors).toEqual([boom]);
    expect(engine.dispose()).toEqual({ disposed: 0, errors: [] });
    expect(order).toEqual(["third", "second", "first"]);
  });

  it("registerCleanup 返回的 remove 撤销登记，dispose 不执行它", () => {
    const engine = engineOf(readFixture(DOCUMENT_FIXTURE_PATH));
    const order: string[] = [];
    const remove = engine.registerCleanup(() => order.push("removed"));
    engine.registerCleanup(() => order.push("kept"));

    remove();
    expect(engine.dispose()).toEqual({ disposed: 1, errors: [] });
    expect(order).toEqual(["kept"]);
  });

  it("dispose 后 apply* 全部 E-PAYLOAD 拒绝：会话不变、不通知、不再记指标", () => {
    const engine = engineOf(readFixture(DOCUMENT_FIXTURE_PATH));
    let notified = 0;
    engine.onChange(() => {
      notified += 1;
    });
    engine.dispose();
    const before = structuredClone(engine.session);

    const failures = [
      failed(engine.applyOps(readFixture(ROUTE_FIXTURE_PATH))),
      failed(engine.applyData(itemsPayload(6, "改"))),
      failed(engine.applyFull(replacementDocument(4))),
    ];

    for (const diagnostics of failures) {
      expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["E-PAYLOAD"]);
      expect(diagnostics[0]?.message).toContain("dispose");
    }
    expect(engine.session).toEqual(before);
    expect(notified).toBe(0);
    expect(engine.metrics).toMatchObject({
      version: 3,
      opsBatches: 0,
      dataUpdates: 0,
      fullUpdates: 0,
      rejections: 0,
      notifications: 0,
    });
  });

  it("注入的 metrics / ledger 与引擎共用", () => {
    const metrics = new RuntimeMetrics();
    const ledger = new LifecycleLedger();
    const engine = engineOf(readFixture(DOCUMENT_FIXTURE_PATH), { metrics, ledger });
    const order: string[] = [];

    applied(engine.applyOps(readFixture(ROUTE_FIXTURE_PATH)));
    engine.registerCleanup(() => order.push("cleanup"));
    engine.dispose();

    expect(metrics.snapshot(4).opsBatches).toBe(1);
    expect(order).toEqual(["cleanup"]);
    expect(ledger.disposed).toBe(true);
  });
});

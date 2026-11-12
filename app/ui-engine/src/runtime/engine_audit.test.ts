import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AuditLog } from "./audit";
import {
  createEngine,
  type EngineApplyResult,
  type EngineOptions,
  type EngineRuntime,
} from "./engine";
import { RuntimeMetrics } from "./metrics";

/**
 * EngineRuntime 的耗时指标与审计（从 engine.test.ts 拆出，保持测试文件行数预算）。
 * fixture 与基础 helper 与 engine.test.ts 同源；共享 fixture 不许改。
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

/** 假钟：每次调用返回下一个数（一次 apply 调两次：起表 / 结算）。 */
function steppedClock(...steps: number[]): () => number {
  let index = 0;
  return (): number => {
    const value = steps[index];
    if (value === undefined) {
      throw new Error("clock 被多调用了一次");
    }
    index += 1;
    return value;
  };
}

/** 全量替换用的另一份文档：树 / pages / active / data 全不同。 */
function replacementDocument(version: number): Record<string, unknown> {
  return {
    schema: "dendro.ui/2",
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

describe("耗时指标：注入 clock 量每次 apply", () => {
  it("成功 apply 记 last / total / max；更短的一次只动 last 与 total", () => {
    const engine = engineOf(readFixture(DOCUMENT_FIXTURE_PATH), {
      clock: steppedClock(100, 112, 200, 207),
    });

    applied(engine.applyData(itemsPayload(6, "改")));
    expect(engine.metrics).toMatchObject({ lastApplyMs: 12, totalApplyMs: 12, maxApplyMs: 12 });

    applied(engine.applyData(itemsPayload(7, "再改")));
    expect(engine.metrics).toMatchObject({ lastApplyMs: 7, totalApplyMs: 19, maxApplyMs: 12 });
  });

  it("失败 apply 也计时；dispose 后的拒绝不计时（假钟只够两次调用）", () => {
    const engine = engineOf(readFixture(DOCUMENT_FIXTURE_PATH), { clock: steppedClock(5, 9) });

    failed(engine.applyData({ kind: "data", source: "x" }));
    expect(engine.metrics).toMatchObject({
      lastApplyMs: 4,
      totalApplyMs: 4,
      maxApplyMs: 4,
      rejections: 1,
    });

    engine.dispose();
    failed(engine.applyData(itemsPayload(6, "改")));
    expect(engine.metrics).toMatchObject({ lastApplyMs: 4, totalApplyMs: 4 });
  });
});

describe("audit：结构化审计与渲染计数", () => {
  it("applyData 成功记 apply（changed 为目标个数），注入的 AuditLog 与引擎共用", () => {
    const audit = new AuditLog();
    const engine = engineOf(readFixture(DOCUMENT_FIXTURE_PATH), { audit });
    expect(engine.audit).toBe(audit);

    applied(engine.applyData(itemsPayload(6, "改")));

    expect(audit.entries()).toEqual([{ seq: 1, kind: "apply", changed: 1 }]);
  });

  it("applyOps 权限拒绝（受限 requester）：记 reject + deny，带 code / 现场 / changed 0", () => {
    const engine = engineOf(readFixture(DOCUMENT_FIXTURE_PATH), {
      requester: { owner: "intruder" },
    });

    const diagnostics = failed(
      engine.applyOps({
        kind: "ops",
        document: 4,
        base: 3,
        seq: 1,
        ops: [{ op: "update", id: "page.ideas", props: { label: "越权" } }],
      }),
    );

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["E-PERMISSION"]);
    expect(engine.audit.entries()).toEqual([
      {
        seq: 1,
        kind: "reject",
        code: "E-PERMISSION",
        message: diagnostics[0]?.message,
        changed: 0,
      },
      {
        seq: 2,
        kind: "deny",
        code: "E-PERMISSION",
        owner: "ideas",
        slot: "page.ideas",
        message: diagnostics[0]?.message,
        changed: 0,
      },
    ]);
    expect(engine.metrics.rejections).toBe(1);
  });

  it("applyData 失败：只记 reject（首条诊断），不记 deny", () => {
    const engine = engineOf(readFixture(DOCUMENT_FIXTURE_PATH));

    const diagnostics = failed(engine.applyData({ kind: "data", source: "x" }));

    const entries = engine.audit.entries();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ seq: 1, kind: "reject", code: "E-PAYLOAD", changed: 0 });
    expect(entries[0]?.message).toBe(diagnostics[0]?.message);
  });

  it("成功但带条目级诊断：apply + 逐条 diagnostic（与指标里的诊断一致）", () => {
    const engine = engineOf(readFixture(DOCUMENT_FIXTURE_PATH));
    const payload = {
      ...itemsPayload(6, "好"),
      items: [
        { id: "42", template: "item", title: "好", meta: "刚刚" },
        { id: "ghost", template: "ghost", title: "坏条目" },
      ],
    };

    applied(engine.applyData(payload));

    const entries = engine.audit.entries();
    expect(entries[0]).toEqual({ seq: 1, kind: "apply", changed: 1 });
    expect(entries[1]).toMatchObject({ seq: 2, kind: "diagnostic", code: "E-TEMPLATE" });
    expect(entries[1]?.message).toBe(engine.metrics.lastDiagnostics[0]?.message);
    expect(engine.metrics.rejections).toBe(0);
    expect(engine.metrics.diagnostics).toBe(1);
  });

  it("applyFull 成功记 apply，changed 固定 1（新根 id）", () => {
    const engine = engineOf(readFixture(DOCUMENT_FIXTURE_PATH));

    applied(engine.applyFull(replacementDocument(4)));

    expect(engine.audit.entries()).toEqual([{ seq: 1, kind: "apply", changed: 1 }]);
  });

  it("noteRender 累加 renders；dispose 后不再计数", () => {
    const metrics = new RuntimeMetrics();
    const engine = engineOf(readFixture(DOCUMENT_FIXTURE_PATH), { metrics });

    engine.noteRender();
    engine.noteRender();
    expect(metrics.snapshot(3).renders).toBe(2);
    expect(engine.metrics.renders).toBe(2);

    engine.dispose();
    engine.noteRender();
    expect(engine.metrics.renders).toBe(2);
  });
});

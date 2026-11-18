import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createEngine, type EngineRuntime } from "../../src/host/engine";

const DOCUMENT_FIXTURE_PATH = fileURLToPath(
  new URL("../../../sdk/tests/fixtures/document.json", import.meta.url),
);

function fixture(): unknown {
  return JSON.parse(readFileSync(DOCUMENT_FIXTURE_PATH, "utf8"));
}

function engineOf(): EngineRuntime {
  const created = createEngine(fixture());
  if (!created.ok) {
    throw new Error("测试文档应能建引擎: " + JSON.stringify(created.diagnostics));
  }
  return created.engine;
}

describe("EngineRuntime.applyDataBatch", () => {
  it("多个 data payload 一次提交：只通知一次、版本一次到位", () => {
    const engine = engineOf();
    let notifications = 0;
    engine.onChange(() => {
      notifications += 1;
    });

    const applied = engine.applyDataBatch(
      [
        { kind: "data", owner: "test", source: "a", revision: 1, value: 1 },
        { kind: "data", owner: "test", source: "b", revision: 1, value: 2 },
      ],
      4,
    );

    expect(applied.ok).toBe(true);
    expect(notifications).toBe(1);
    expect(engine.session.document.version).toBe(4);
    expect(engine.session.data).toMatchObject({
      a: { revision: 1, value: 1 },
      b: { revision: 1, value: 2 },
    });
    expect(engine.metrics).toMatchObject({
      version: 4,
      dataUpdates: 2,
      notifications: 1,
      rejections: 0,
    });
    engine.dispose();
  });

  it("整批原子：后一条非法时前一条也不落地", () => {
    const engine = engineOf();
    const before = structuredClone(engine.session);
    let notifications = 0;
    engine.onChange(() => {
      notifications += 1;
    });

    const failed = engine.applyDataBatch(
      [
        { kind: "data", owner: "test", source: "a", revision: 1, value: 1 },
        { kind: "data", owner: "test", revision: 1, value: 2 },
      ],
      4,
    );

    expect(failed.ok).toBe(false);
    expect(notifications).toBe(0);
    expect(engine.session).toEqual(before);
    expect(engine.metrics).toMatchObject({ version: 3, rejections: 1 });
    engine.dispose();
  });
});

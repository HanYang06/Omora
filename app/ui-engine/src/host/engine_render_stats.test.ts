import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { RenderStats } from "../contract/render";
import { createEngine, type EngineRuntime } from "./engine";

/**
 * EngineRuntime 的渲染统计接线：recordRenderStats 累加节点计数并覆盖 lastRender；
 * 与 noteRender（渲染次数）互相独立；dispose 后引擎收口、不再记（与其他观测一致）。
 */

const DOCUMENT_FIXTURE_PATH = fileURLToPath(
  new URL("../../../sdk/tests/fixtures/document.json", import.meta.url),
);

function engineOf(): EngineRuntime {
  const value: unknown = JSON.parse(readFileSync(DOCUMENT_FIXTURE_PATH, "utf8"));
  const created = createEngine(value);
  if (!created.ok) {
    throw new Error("测试文档应能建引擎: " + JSON.stringify(created.diagnostics));
  }
  return created.engine;
}

function stats(over: Partial<RenderStats> = {}): RenderStats {
  return { created: 0, updated: 0, reused: 0, removed: 0, ...over };
}

describe("EngineRuntime：渲染节点统计", () => {
  it("recordRenderStats 累加四个节点计数，lastRender 换成最近一次渲染的副本", () => {
    const engine = engineOf();

    engine.recordRenderStats(stats({ created: 7 }));

    expect(engine.metrics).toMatchObject({
      nodesCreated: 7,
      nodesUpdated: 0,
      nodesReused: 0,
      nodesRemoved: 0,
      lastRender: stats({ created: 7 }),
    });

    engine.recordRenderStats(stats({ created: 1, updated: 2, reused: 3, removed: 4 }));

    expect(engine.metrics).toMatchObject({
      nodesCreated: 8,
      nodesUpdated: 2,
      nodesReused: 3,
      nodesRemoved: 4,
      lastRender: stats({ created: 1, updated: 2, reused: 3, removed: 4 }),
    });
  });

  it("lastRender 是副本：改引擎快照里的 lastRender 不影响后续快照", () => {
    const engine = engineOf();
    engine.recordRenderStats(stats({ created: 5, reused: 2 }));

    const snapshot = engine.metrics;
    snapshot.lastRender.created = 99;
    snapshot.nodesCreated = 99;

    expect(engine.metrics.lastRender).toEqual(stats({ created: 5, reused: 2 }));
    expect(engine.metrics.nodesCreated).toBe(5);
  });

  it("渲染次数与节点统计互不代替：noteRender 只涨 renders，recordRenderStats 只涨节点计数", () => {
    const engine = engineOf();

    engine.noteRender();
    expect(engine.metrics).toMatchObject({ renders: 1, nodesCreated: 0, nodesRemoved: 0 });

    engine.recordRenderStats(stats({ created: 3, removed: 1 }));
    expect(engine.metrics).toMatchObject({ renders: 1, nodesCreated: 3, nodesRemoved: 1 });
  });

  it("dispose 后不记：节点统计与渲染次数都保持 dispose 前的值", () => {
    const engine = engineOf();
    engine.noteRender();
    engine.recordRenderStats(stats({ created: 4, updated: 1 }));
    const before = engine.metrics;

    engine.dispose();
    engine.noteRender();
    engine.recordRenderStats(stats({ created: 100, updated: 50, reused: 25, removed: 10 }));

    expect(engine.metrics).toMatchObject({
      renders: before.renders,
      nodesCreated: before.nodesCreated,
      nodesUpdated: before.nodesUpdated,
      nodesReused: before.nodesReused,
      nodesRemoved: before.nodesRemoved,
      lastRender: before.lastRender,
    });
  });
});

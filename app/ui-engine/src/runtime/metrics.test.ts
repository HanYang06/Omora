import { describe, expect, it } from "vitest";
import { makeDiagnostic } from "./diagnostics";
import { RuntimeMetrics, type RuntimeMetricsSnapshot } from "./metrics";

function diagnostic(message: string) {
  return makeDiagnostic("E-PAYLOAD", message, { path: "$.x" });
}

const ZERO_SNAPSHOT: RuntimeMetricsSnapshot = {
  version: 5,
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
};

describe("RuntimeMetrics：计数与快照", () => {
  it("按字段累加、未给出的字段不动，version 由调用方填", () => {
    const metrics = new RuntimeMetrics();

    metrics.count({ opsBatches: 2, opsCount: 5 });
    metrics.count({ opsCount: 3, notifications: 1 });

    expect(metrics.snapshot(7)).toEqual({
      version: 7,
      opsBatches: 2,
      opsCount: 8,
      dataUpdates: 0,
      fullUpdates: 0,
      localTreeUpdates: 0,
      rejections: 0,
      diagnostics: 0,
      lastDiagnostics: [],
      notifications: 1,
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

  it("recordDiagnostics 累计条数，并把最近诊断整批换成这一批", () => {
    const metrics = new RuntimeMetrics();
    const first = [diagnostic("第一批-1"), diagnostic("第一批-2")];
    const second = [diagnostic("第二批-1")];

    metrics.recordDiagnostics(first);
    expect(metrics.snapshot(1).diagnostics).toBe(2);
    expect(metrics.snapshot(1).lastDiagnostics.map((item) => item.message)).toEqual([
      "第一批-1",
      "第一批-2",
    ]);

    metrics.recordDiagnostics(second);
    const snapshot = metrics.snapshot(1);
    expect(snapshot.diagnostics).toBe(3);
    expect(snapshot.lastDiagnostics.map((item) => item.message)).toEqual(["第二批-1"]);
  });

  it("成功的空批清空 lastDiagnostics，但不减累计条数", () => {
    const metrics = new RuntimeMetrics();
    metrics.recordDiagnostics([diagnostic("一次失败")]);

    metrics.recordDiagnostics([]);

    const snapshot = metrics.snapshot(2);
    expect(snapshot.diagnostics).toBe(1);
    expect(snapshot.lastDiagnostics).toEqual([]);
  });

  it("快照是副本：改快照或改传入的诊断都不影响内部状态", () => {
    const metrics = new RuntimeMetrics();
    const source = [diagnostic("原始")];
    metrics.recordDiagnostics(source);
    metrics.count({ opsBatches: 1 });

    const snapshot = metrics.snapshot(3);
    snapshot.lastDiagnostics[0] = diagnostic("被改的副本");
    snapshot.opsBatches = 99;
    source[0] = diagnostic("被改的入参");

    const next = metrics.snapshot(3);
    expect(next.lastDiagnostics.map((item) => item.message)).toEqual(["原始"]);
    expect(next.opsBatches).toBe(1);
  });

  it("localTreeUpdates 经 count 累加，与 fullUpdates 互不影响", () => {
    const metrics = new RuntimeMetrics();

    metrics.count({ localTreeUpdates: 1 });
    metrics.count({ localTreeUpdates: 2, fullUpdates: 1 });

    expect(metrics.snapshot(1)).toMatchObject({ localTreeUpdates: 3, fullUpdates: 1 });
  });

  it("renders 经 count 累加，是独立计数", () => {
    const metrics = new RuntimeMetrics();

    metrics.count({ renders: 1 });
    metrics.count({ renders: 1, notifications: 1 });

    expect(metrics.snapshot(1)).toMatchObject({ renders: 2, notifications: 1 });
  });

  it("recordRenderStats 累加节点计数，并把 lastRender 换成这次渲染的副本", () => {
    const metrics = new RuntimeMetrics();

    metrics.recordRenderStats({ created: 5, updated: 0, reused: 0, removed: 0 });
    expect(metrics.snapshot(1)).toMatchObject({
      nodesCreated: 5,
      nodesUpdated: 0,
      nodesReused: 0,
      nodesRemoved: 0,
      lastRender: { created: 5, updated: 0, reused: 0, removed: 0 },
    });

    metrics.recordRenderStats({ created: 1, updated: 2, reused: 3, removed: 4 });
    expect(metrics.snapshot(1)).toMatchObject({
      nodesCreated: 6,
      nodesUpdated: 2,
      nodesReused: 3,
      nodesRemoved: 4,
      lastRender: { created: 1, updated: 2, reused: 3, removed: 4 },
    });
  });

  it("lastRender 是副本：改快照或改传入的统计都不影响内部状态", () => {
    const metrics = new RuntimeMetrics();
    const source = { created: 1, updated: 2, reused: 3, removed: 4 };
    metrics.recordRenderStats(source);

    const snapshot = metrics.snapshot(1);
    snapshot.lastRender.created = 99;
    source.created = 88;

    const next = metrics.snapshot(1);
    expect(next.lastRender).toEqual({ created: 1, updated: 2, reused: 3, removed: 4 });
    expect(next.nodesCreated).toBe(1);
  });

  it("recordTiming 覆盖 last、累加 total、max 取大，且不动其余计数", () => {
    const metrics = new RuntimeMetrics();
    metrics.count({ dataUpdates: 1 });

    metrics.recordTiming(5);
    expect(metrics.snapshot(1)).toMatchObject({
      lastApplyMs: 5,
      totalApplyMs: 5,
      maxApplyMs: 5,
      dataUpdates: 1,
    });

    metrics.recordTiming(12);
    expect(metrics.snapshot(1)).toMatchObject({
      lastApplyMs: 12,
      totalApplyMs: 17,
      maxApplyMs: 12,
      dataUpdates: 1,
    });

    metrics.recordTiming(3);
    expect(metrics.snapshot(1)).toMatchObject({
      lastApplyMs: 3,
      totalApplyMs: 20,
      maxApplyMs: 12,
      dataUpdates: 1,
    });
  });

  it("reset 清零全部计数、耗时与最近诊断，version 仍由下次 snapshot 填", () => {
    const metrics = new RuntimeMetrics();
    metrics.count({
      opsBatches: 1,
      opsCount: 2,
      dataUpdates: 3,
      fullUpdates: 4,
      localTreeUpdates: 7,
      rejections: 5,
      notifications: 6,
      renders: 2,
    });
    metrics.recordRenderStats({ created: 5, updated: 3, reused: 2, removed: 1 });
    metrics.recordTiming(40);
    metrics.recordDiagnostics([diagnostic("失败")]);

    metrics.reset();

    expect(metrics.snapshot(5)).toEqual(ZERO_SNAPSHOT);
  });
});

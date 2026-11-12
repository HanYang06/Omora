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
  rejections: 0,
  diagnostics: 0,
  lastDiagnostics: [],
  notifications: 0,
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
      rejections: 0,
      diagnostics: 0,
      lastDiagnostics: [],
      notifications: 1,
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

  it("reset 清零全部计数与最近诊断，version 仍由下次 snapshot 填", () => {
    const metrics = new RuntimeMetrics();
    metrics.count({
      opsBatches: 1,
      opsCount: 2,
      dataUpdates: 3,
      fullUpdates: 4,
      rejections: 5,
      notifications: 6,
    });
    metrics.recordDiagnostics([diagnostic("失败")]);

    metrics.reset();

    expect(metrics.snapshot(5)).toEqual(ZERO_SNAPSHOT);
  });
});

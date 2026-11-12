/**
 * Dendrolink 引擎运行时指标（S4）：纯计数器，不碰 DOM、不读时钟、不打日志。
 *
 * 观测依据 docs/engine/runtime.md §6：引擎至少要能量出补丁条数与 op 数、数据 / 全量
 * 更新、被拒绝的更新、诊断条数与最近一批诊断、发出过多少次变更通知。指标进日志与
 * 开发面板，不上用户界面；这里只负责累计与快照，导出 / 采样 / 打日志由宿主决定。
 *
 * 语义：
 * - `count` 按字段累加，只加调用方给出的字段，其余不动。没有回绕 / 负数这类花活：
 *   引擎每处理完一次输入调用一次；失败路径该记哪些字段由调用方负责。
 * - `recordDiagnostics` 每批输入调用一次（成功时传空数组也算一批）：累计条数加上本批
 *   长度，`lastDiagnostics` 整批替换为本批的副本。这样 `lastDiagnostics` 永远代表
 *   「最近一次输入产生的诊断」，成功的空批会把上一次失败的诊断清掉。
 * - `snapshot` 是纯数据快照：`version` 由引擎用当前会话版本填（指标模块不认识会话），
 *   `lastDiagnostics` 是副本；调用方改快照不影响计数器。
 * - `reset` 清零全部计数与最近诊断；引擎不主动 reset（宿主 / 开发面板按需调用）。
 */

import type { Diagnostic } from "../link/types";

/** 可累加的计数字段；诊断条数只经 `recordDiagnostics` 累加（要同步维护最近诊断）。 */
export type MetricCounter =
  "opsBatches" | "opsCount" | "dataUpdates" | "fullUpdates" | "rejections" | "notifications";

/** 一次 `count` 的增量：只写要加的字段。 */
export type MetricsCounts = Partial<Record<MetricCounter, number>>;

/** 运行时指标快照（纯数据，可直接 JSON 序列化进日志 / 开发面板）。 */
export interface RuntimeMetricsSnapshot {
  /** 快照时刻的会话文档版本；由引擎填，指标模块只搬运。 */
  version: number;
  /** 成功应用的 ops 批量数。 */
  opsBatches: number;
  /** 成功应用的 ops 总条数（含同批里的 route）。 */
  opsCount: number;
  /** 成功应用的数据更新条数（含幂等重放这种 no-op）。 */
  dataUpdates: number;
  /** 成功应用的全量替换次数。 */
  fullUpdates: number;
  /** 被拒绝的 apply 次数（失败的批量只算一次，不按诊断条数算）。 */
  rejections: number;
  /** 累计诊断条数（每批输入产生的诊断数量相加）。 */
  diagnostics: number;
  /** 最近一批输入产生的诊断（副本；成功的空批是空数组）。 */
  lastDiagnostics: Diagnostic[];
  /** 已派发的变更通知次数（每次通知 = 一个监听者被调用一次）。 */
  notifications: number;
}

const COUNTERS: readonly MetricCounter[] = [
  "opsBatches",
  "opsCount",
  "dataUpdates",
  "fullUpdates",
  "rejections",
  "notifications",
];

function zeroCounters(): Record<MetricCounter, number> {
  return {
    opsBatches: 0,
    opsCount: 0,
    dataUpdates: 0,
    fullUpdates: 0,
    rejections: 0,
    notifications: 0,
  };
}

function copyDiagnostics(diagnostics: readonly Diagnostic[]): Diagnostic[] {
  return diagnostics.map((diagnostic) => ({ ...diagnostic }));
}

/** 引擎运行时指标计数器：一局引擎一份，宿主也可注入自己的实例做集中观测。 */
export class RuntimeMetrics {
  private readonly counters: Record<MetricCounter, number> = zeroCounters();
  private diagnosticCount = 0;
  private recentDiagnostics: Diagnostic[] = [];

  /** 按字段累加；只加给出的字段。 */
  count(delta: MetricsCounts): void {
    for (const counter of COUNTERS) {
      const amount = delta[counter];
      if (amount !== undefined) {
        this.counters[counter] += amount;
      }
    }
  }

  /** 记一批诊断：累计条数加上本批长度，最近诊断整批替换为本批副本。 */
  recordDiagnostics(diagnostics: readonly Diagnostic[]): void {
    this.diagnosticCount += diagnostics.length;
    this.recentDiagnostics = copyDiagnostics(diagnostics);
  }

  /** 当前快照；`version` 由调用方（引擎）用会话版本填。 */
  snapshot(version: number): RuntimeMetricsSnapshot {
    return {
      version,
      opsBatches: this.counters.opsBatches,
      opsCount: this.counters.opsCount,
      dataUpdates: this.counters.dataUpdates,
      fullUpdates: this.counters.fullUpdates,
      rejections: this.counters.rejections,
      diagnostics: this.diagnosticCount,
      lastDiagnostics: copyDiagnostics(this.recentDiagnostics),
      notifications: this.counters.notifications,
    };
  }

  /** 清零全部计数与最近诊断；快照的 version 下次仍由调用方填。 */
  reset(): void {
    this.counters.opsBatches = 0;
    this.counters.opsCount = 0;
    this.counters.dataUpdates = 0;
    this.counters.fullUpdates = 0;
    this.counters.rejections = 0;
    this.counters.notifications = 0;
    this.diagnosticCount = 0;
    this.recentDiagnostics = [];
  }
}

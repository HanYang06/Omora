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
 * - `recordTiming` 每次 apply 结算调用一次（成功 / 失败都算）：`lastApplyMs` 覆盖、
 *   `totalApplyMs` 累加、`maxApplyMs` 取最大。耗时不在这里量：引擎用注入的 clock 量好
 *   再传进来，所以指标模块不读时钟、测试可以确定性地喂数字。`recordTiming` 不动其余计数。
 * - `renders` 由渲染侧每次重画时调 `count({ renders: 1 })`（引擎的 `noteRender`）累计。
 * - `recordRenderStats` 每次重画后由宿主把渲染器的节点统计上报一次：`nodesCreated /
 *   nodesUpdated / nodesReused / nodesRemoved` 按字段累加，`lastRender` 整批替换为本
 *   次统计的副本（与 `recordDiagnostics` 的「最近一批」语义一致）。空渲染（0 个节点）也
 *   照常上报，`lastRender` 会覆盖成全零。节点计数只经这个方法维护，不走 `count`。
 *   字段关系沿用渲染器的定义：`nodesUpdated` 是 `nodesReused` 的子集（复用的节点里
 *   真正执行了 kind.update 的那部分），`nodesCreated + nodesReused` 是每轮渲染的存活
 *   条目数之和；不要把 updated 与 reused 相加当总数。
 * - `localTreeUpdates` 由 `applyLocalTrees` 成功后 `count({ localTreeUpdates: 1 })` 累计；
 *   整组局部树重新链接算一次，不按树数算。
 * - `snapshot` 是纯数据快照：`version` 由引擎用当前会话版本填（指标模块不认识会话），
 *   `lastDiagnostics` 是副本；调用方改快照不影响计数器。
 * - `reset` 清零全部计数、最近诊断与最近渲染统计；引擎不主动 reset（宿主 / 开发面板按需调用）。
 */

// 只借契约层的统计类型（`import type` 在运行时擦除）：指标模块不 import 渲染实现，
// 也不持有 DOM 引用；真正上报的是宿主（DocumentView）。
import type { RenderStats } from "../contract/render";
import type { Diagnostic } from "../contract/diagnostics";

/**
 * 可累加的计数字段；诊断条数只经 `recordDiagnostics` 累加（要同步维护最近诊断），
 * 耗时只经 `recordTiming` 维护。
 */
export type MetricCounter =
  | "opsBatches"
  | "opsCount"
  | "dataUpdates"
  | "fullUpdates"
  | "localTreeUpdates"
  | "rejections"
  | "notifications"
  | "renders";

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
  /** 成功应用的全量 local-trees 重组次数（整组局部树重新链接成一个根树）。 */
  localTreeUpdates: number;
  /** 被拒绝的 apply 次数（失败的批量只算一次，不按诊断条数算）。 */
  rejections: number;
  /** 累计诊断条数（每批输入产生的诊断数量相加）。 */
  diagnostics: number;
  /** 最近一批输入产生的诊断（副本；成功的空批是空数组）。 */
  lastDiagnostics: Diagnostic[];
  /** 已派发的变更通知次数（每次通知 = 一个监听者被调用一次）。 */
  notifications: number;
  /** 渲染次数（DocumentView 每次重画记一次）。 */
  renders: number;
  /** 累计新建节点数（每次重画后由渲染器的 RenderStats 累加）。 */
  nodesCreated: number;
  /** 累计被 kind.update 更新的节点数（是 nodesReused 的子集）。 */
  nodesUpdated: number;
  /** 累计复用的节点数（含被 update 的，updated ⊆ reused）。 */
  nodesReused: number;
  /** 累计销毁的节点数。 */
  nodesRemoved: number;
  /** 最近一次渲染的节点统计（副本；还没渲染过时全零）。 */
  lastRender: RenderStats;
  /** 最近一次 apply 的耗时（毫秒，由引擎用注入 clock 量）。 */
  lastApplyMs: number;
  /** 全部 apply 的耗时总和（毫秒；成功 / 失败都算）。 */
  totalApplyMs: number;
  /** 单次 apply 的最大耗时（毫秒；初值 0）。 */
  maxApplyMs: number;
}

const COUNTERS: readonly MetricCounter[] = [
  "opsBatches",
  "opsCount",
  "dataUpdates",
  "fullUpdates",
  "localTreeUpdates",
  "rejections",
  "notifications",
  "renders",
];

function zeroCounters(): Record<MetricCounter, number> {
  return {
    opsBatches: 0,
    opsCount: 0,
    dataUpdates: 0,
    fullUpdates: 0,
    localTreeUpdates: 0,
    rejections: 0,
    notifications: 0,
    renders: 0,
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
  private readonly nodeCounts: RenderStats = { created: 0, updated: 0, reused: 0, removed: 0 };
  private lastRenderStats: RenderStats = { created: 0, updated: 0, reused: 0, removed: 0 };
  private lastTiming = 0;
  private totalTiming = 0;
  private maxTiming = 0;

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

  /**
   * 记一次渲染的节点统计：四个计数按字段累加，`lastRender` 整批换成这次统计的副本；
   * 其余计数 / 诊断 / 耗时不动。
   */
  recordRenderStats(stats: RenderStats): void {
    this.nodeCounts.created += stats.created;
    this.nodeCounts.updated += stats.updated;
    this.nodeCounts.reused += stats.reused;
    this.nodeCounts.removed += stats.removed;
    this.lastRenderStats = { ...stats };
  }

  /** 记一次 apply 耗时：覆盖 last、累加 total、max 取大；其余计数不动。 */
  recordTiming(ms: number): void {
    this.lastTiming = ms;
    this.totalTiming += ms;
    if (ms > this.maxTiming) {
      this.maxTiming = ms;
    }
  }

  /** 当前快照；`version` 由调用方（引擎）用会话版本填。 */
  snapshot(version: number): RuntimeMetricsSnapshot {
    return {
      version,
      opsBatches: this.counters.opsBatches,
      opsCount: this.counters.opsCount,
      dataUpdates: this.counters.dataUpdates,
      fullUpdates: this.counters.fullUpdates,
      localTreeUpdates: this.counters.localTreeUpdates,
      rejections: this.counters.rejections,
      diagnostics: this.diagnosticCount,
      lastDiagnostics: copyDiagnostics(this.recentDiagnostics),
      notifications: this.counters.notifications,
      renders: this.counters.renders,
      nodesCreated: this.nodeCounts.created,
      nodesUpdated: this.nodeCounts.updated,
      nodesReused: this.nodeCounts.reused,
      nodesRemoved: this.nodeCounts.removed,
      lastRender: { ...this.lastRenderStats },
      lastApplyMs: this.lastTiming,
      totalApplyMs: this.totalTiming,
      maxApplyMs: this.maxTiming,
    };
  }

  /** 清零全部计数、耗时、最近诊断与最近渲染统计；快照的 version 下次仍由调用方填。 */
  reset(): void {
    this.counters.opsBatches = 0;
    this.counters.opsCount = 0;
    this.counters.dataUpdates = 0;
    this.counters.fullUpdates = 0;
    this.counters.localTreeUpdates = 0;
    this.counters.rejections = 0;
    this.counters.notifications = 0;
    this.counters.renders = 0;
    this.diagnosticCount = 0;
    this.recentDiagnostics = [];
    this.nodeCounts.created = 0;
    this.nodeCounts.updated = 0;
    this.nodeCounts.reused = 0;
    this.nodeCounts.removed = 0;
    this.lastRenderStats = { created: 0, updated: 0, reused: 0, removed: 0 };
    this.lastTiming = 0;
    this.totalTiming = 0;
    this.maxTiming = 0;
  }
}

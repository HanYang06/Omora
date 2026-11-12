/**
 * Dendrolink 引擎运行时（S4）：会话 + 生命周期账本 + 指标 + 变更通知。
 *
 * 这是 S3 纯函数运行时对宿主 / 渲染层的唯一入口：宿主把线上 payload（ops 批量、
 * 数据更新、全量文档）交给 applyOps / applyData / applyFull，引擎校验并原子应用；
 * 成功后换掉内部会话快照、记指标、通知监听者，失败只回诊断、会话不动。
 * session / data / hydrate / ops 的语义不在这里重写，本模块只做编排。
 *
 * 建引擎：createEngine 先 createSession（文档形状 / 版本）再 hydrateSession（把数据
 * 投影物化成集合实例）；任何一步不合法返回诊断、不建引擎。水合阶段（数据已到但有
 * 坏条目）的条目级诊断不阻断建引擎，但记进指标，开发面板能看见「数据到了但条目坏了」。
 *
 * 通知语义：每次成功 apply 派发一次通知（包括幂等重放这种 changed 为空的成功）；
 * 监听者拿到当前会话与这次 apply 的 changed。监听者集合在派发开始时快照，派发期间的
 * 取消从下一次 apply 起生效；单个监听者抛错被隔离，不影响其余监听者与 apply 结果。
 *
 * 指标语义：失败记 rejections 一次并把本批诊断记进指标；成功也把本批诊断（可能为空）
 * 记成 lastDiagnostics，成功但有条目级诊断时累计条数照加。通知数按实际调用到的监听者
 * 个数累加。
 *
 * 生命周期：registerCleanup 把清理登记进 LifecycleLedger，dispose 时先清空监听再
 * 逆序撤销全部清理（单个失败隔离、最后汇总）。dispose 幂等，之后再 apply 一律
 * E-PAYLOAD 失败：不改会话、不通知、不记指标（引擎已收口，不再观测）。
 */

import type { Diagnostic } from "../link/types";
import { applyData as applyDataUpdate, type DataState } from "./data";
import { makeDiagnostic } from "./diagnostics";
import { hydrateSession } from "./hydrate";
import { LifecycleLedger, type DisposeReport } from "./lifecycle";
import { RuntimeMetrics, type MetricsCounts, type RuntimeMetricsSnapshot } from "./metrics";
import { parseOps } from "./ops";
import {
  applyFull as applyFullDocument,
  applySessionOps,
  createSession,
  type SessionState,
} from "./session";

/** 建引擎时可选注入的运行时设施；默认各建一份。 */
export interface EngineOptions {
  metrics?: RuntimeMetrics;
  ledger?: LifecycleLedger;
}

/** 变更监听者：拿到 apply 之后的会话与这次 apply 的 changed（被触碰的子树根 id）。 */
export type EngineChangeListener = (session: SessionState, changed: readonly string[]) => void;

/** createEngine 结果：建成就给引擎；文档 / 水合不合法只给诊断。 */
export type CreateEngineResult =
  { ok: true; engine: EngineRuntime } | { ok: false; diagnostics: Diagnostic[] };

/**
 * apply 结果：成功给 changed 与新的会话快照；失败只给诊断，引擎内会话不变。
 * applyFull 的 changed 固定是新根树的根 id（整棵树被替换，渲染层按根重画）。
 */
export type EngineApplyResult =
  { ok: true; changed: string[]; session: SessionState } | { ok: false; diagnostics: Diagnostic[] };

/** dispose 之后 apply 的诊断：复用 E-PAYLOAD（引擎已不允许再写，属于调用方时机错误）。 */
const DISPOSED_MESSAGE = "引擎已销毁（dispose），不再接受 applyOps / applyData / applyFull";

/** dispose 之后的空取消 / 空清理。 */
const NOOP = (): void => {};

/**
 * 有状态引擎运行时：一份会话快照 + 生命周期账本 + 指标 + 变更监听。
 *
 * 直接 new 只接受已校验、已水合的会话；宿主走 `createEngine`。
 */
export class EngineRuntime {
  private current: SessionState;
  private readonly counter: RuntimeMetrics;
  private readonly ledger: LifecycleLedger;
  private readonly listeners = new Set<EngineChangeListener>();
  private isDisposed = false;

  constructor(session: SessionState, options: EngineOptions = {}) {
    this.current = session;
    this.counter = options.metrics ?? new RuntimeMetrics();
    this.ledger = options.ledger ?? new LifecycleLedger();
  }

  /** 当前会话快照；只读，调用方不得改写（引擎每次 apply 换新快照，不做原地修改）。 */
  get session(): SessionState {
    return this.current;
  }

  /** 当前指标快照；version 用当前会话的文档版本填。 */
  get metrics(): RuntimeMetricsSnapshot {
    return this.counter.snapshot(this.current.document.version);
  }

  /** 登记一个清理函数，返回撤销登记的函数；账本语义见 lifecycle.ts。 */
  registerCleanup(dispose: () => void): () => void {
    return this.ledger.add(dispose);
  }

  /** 注册变更监听者，返回取消函数；dispose 后不再接受注册（返回空取消）。 */
  onChange(listener: EngineChangeListener): () => void {
    if (this.isDisposed) {
      return NOOP;
    }
    this.listeners.add(listener);
    return (): void => {
      this.listeners.delete(listener);
    };
  }

  /** 应用一批线上 ops（route 可与树 op 混批）；失败整批不生效。 */
  applyOps(batch: unknown): EngineApplyResult {
    if (this.isDisposed) {
      return this.disposedFailure();
    }
    // 先解析一次拿 op 条数（指标按批量总条数计，route 也算）；applySessionOps 会再解析
    // 一遍归一化后的批次，形状校验幂等，这点成本换「指标不依赖内部解析产物」。
    const parsed = parseOps(batch);
    if (!parsed.ok) {
      return this.reject(parsed.diagnostics);
    }
    const applied = applySessionOps(this.current, parsed.batch);
    if (!applied.ok) {
      return this.reject(applied.diagnostics);
    }
    return this.publish(
      applied.session,
      applied.changed,
      { opsBatches: 1, opsCount: parsed.batch.ops.length },
      [],
    );
  }

  /** 应用一条数据更新（标量 / 集合全量 / 集合增量）；条目级坏数据只丢自己并记诊断。 */
  applyData(payload: unknown): EngineApplyResult {
    if (this.isDisposed) {
      return this.disposedFailure();
    }
    // session.data 由文档校验 + 深拷而来，形状就是数据文档投影；纯函数层只读它。
    const applied = applyDataUpdate(this.current.document, this.current.data as DataState, payload);
    if (!applied.ok) {
      return this.reject(applied.diagnostics);
    }
    const next: SessionState = {
      document: applied.document,
      pages: this.current.pages,
      active: this.current.active,
      data: applied.data,
    };
    return this.publish(next, applied.changed, { dataUpdates: 1 }, applied.diagnostics);
  }

  /** 全量替换整份会话并重新水合集合实例；旧版本全量被 applyFull 拒绝。 */
  applyFull(value: unknown): EngineApplyResult {
    if (this.isDisposed) {
      return this.disposedFailure();
    }
    const replaced = applyFullDocument(this.current, value);
    if (!replaced.ok) {
      return this.reject(replaced.diagnostics);
    }
    const hydrated = hydrateSession(replaced.session);
    if (!hydrated.ok) {
      return this.reject(hydrated.diagnostics);
    }
    // 全量替换后整棵树都是新的；changed 用新根 id 表示「按根重画」，不逐个列实例 id。
    return this.publish(
      hydrated.session,
      [hydrated.session.document.root.id],
      { fullUpdates: 1 },
      hydrated.diagnostics,
    );
  }

  /**
   * 卸载：清空监听 + 逆序撤销全部清理；幂等（第二次返回空结算）。
   * 单个清理抛错由账本隔离并按执行顺序汇总进 errors。
   */
  dispose(): DisposeReport {
    if (this.isDisposed) {
      return { disposed: 0, errors: [] };
    }
    this.isDisposed = true;
    this.listeners.clear();
    return this.ledger.disposeAll();
  }

  /** 成功提交：换会话 → 记诊断 → 记计数（含通知数）→ 按快照派发通知。 */
  private publish(
    session: SessionState,
    changed: string[],
    counts: MetricsCounts,
    diagnostics: Diagnostic[],
  ): EngineApplyResult {
    this.current = session;
    this.counter.recordDiagnostics(diagnostics);
    // 派发前快照监听者：通知期间的取消从下一次 apply 起生效，通知数按快照长度计。
    const listeners = [...this.listeners];
    this.counter.count({ ...counts, notifications: listeners.length });
    for (const listener of listeners) {
      try {
        listener(session, changed);
      } catch {
        // 错误隔离：单个监听者失败不拖垮 apply，也不影响其余监听者。
      }
    }
    return { ok: true, changed, session };
  }

  /** 失败结算：rejections +1，本批诊断记进指标，会话不动。 */
  private reject(diagnostics: Diagnostic[]): EngineApplyResult {
    this.counter.count({ rejections: 1 });
    this.counter.recordDiagnostics(diagnostics);
    return { ok: false, diagnostics };
  }

  /** dispose 之后的统一拒绝：E-PAYLOAD，不改会话、不通知、不记指标。 */
  private disposedFailure(): EngineApplyResult {
    return {
      ok: false,
      diagnostics: [makeDiagnostic("E-PAYLOAD", DISPOSED_MESSAGE, { path: "$" })],
    };
  }
}

/**
 * 从整份 v2 文档建引擎：createSession + hydrateSession；不合法返回诊断、不建引擎。
 *
 * 水合期间的条目级诊断（坏条目只丢自己，ok 仍为 true）记进指标，不阻断建引擎。
 */
export function createEngine(value: unknown, options: EngineOptions = {}): CreateEngineResult {
  const created = createSession(value);
  if (!created.ok) {
    return created;
  }
  const hydrated = hydrateSession(created.session);
  if (!hydrated.ok) {
    return { ok: false, diagnostics: hydrated.diagnostics };
  }
  const metrics = options.metrics ?? new RuntimeMetrics();
  metrics.recordDiagnostics(hydrated.diagnostics);
  return { ok: true, engine: new EngineRuntime(hydrated.session, { ...options, metrics }) };
}

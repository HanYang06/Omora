/**
 * Dendrolink 引擎运行时（S4）：会话 + 生命周期账本 + 指标 + 变更通知。
 *
 * 这是 S3 纯函数运行时对宿主 / 渲染层的唯一入口：宿主把线上 payload（ops 批量、
 * 数据更新、全量文档、全量局部树）交给 applyOps / applyData / applyFull /
 * applyLocalTrees，引擎校验并原子应用；成功后换掉内部会话快照、记指标、通知监听者，
 * 失败只回诊断、会话不动。session / data / hydrate / ops / link 的语义不在这里重写，
 * 本模块只做编排。
 *
 * 建引擎：createEngine 先 createSession（文档形状 / 版本）再 hydrateSession（把数据
 * 投影物化成集合实例）；任何一步不合法返回诊断、不建引擎。水合阶段（数据已到但有
 * 坏条目）的条目级诊断不阻断建引擎，但记进指标，开发面板能看见「数据到了但条目坏了」。
 *
 * 全量局部树（applyLocalTrees）：整组局部树经链接器重链到窗口骨架（S2 的 link，不改
 * 其语义），成功就整棵树换成新的权威根树、文档版本 +1，再用**当前** data 重新水合
 * 集合实例；链接 / 水合失败都走同一套 reject，会话不变。payload 里没有页面侧表，
 * 所以 pages / active 原样保留（页面侧表的上线形状后续再补）；data 也不动，只当水合输入。
 * 链接期权限复用引擎的 requester：带了 requester 就 requesterFor 每棵树都返回它（越权
 * 在链接期 E-PERMISSION），不带就是链接器的系统来源默认（全放行）。
 *
 * 通知语义：每次成功 apply 派发一次通知（包括幂等重放这种 changed 为空的成功）；
 * 监听者拿到当前会话与这次 apply 的 changed。监听者集合在派发开始时快照，派发期间的
 * 取消从下一次 apply 起生效；单个监听者抛错被隔离，不影响其余监听者与 apply 结果。
 *
 * 指标语义：失败记 rejections 一次并把本批诊断记进指标；成功也把本批诊断（可能为空）
 * 记成 lastDiagnostics，成功但有条目级诊断时累计条数照加。通知数按实际调用到的监听者
 * 个数累加。
 *
 * 审计 / 耗时语义：每次 apply 先用注入的 clock（默认 Date.now）起表，成功 / 失败都以
 * recordTiming 结算。成功记一条 apply 审计（changed = 被触碰的子树根个数），失败记一条
 * reject 审计（首条诊断的 code / message，changed = 0）；成功但带条目级诊断时逐条记
 * diagnostic，失败里含 E-PERMISSION 时额外逐条记 deny（带现场 owner / slot）。
 * `audit` getter 暴露日志本体，`noteRender` 供 DocumentView 每次重画累加渲染计数。
 *
 * 生命周期：registerCleanup 把清理登记进 LifecycleLedger，dispose 时先清空监听再
 * 逆序撤销全部清理（单个失败隔离、最后汇总）。dispose 幂等，之后再 apply 一律
 * E-PAYLOAD 失败：不改会话、不通知、不记指标 / 审计（引擎已收口，不再观测）。
 */

import { link } from "../link/link";
import { WINDOW_SCAFFOLD } from "../link/scaffold";
import type { Diagnostic, LinkOptions } from "../link/types";
import { AuditLog } from "./audit";
import { applyData as applyDataUpdate, type DataState } from "./data";
import { makeDiagnostic } from "./diagnostics";
import { hydrateSession } from "./hydrate";
import { LifecycleLedger, type DisposeReport } from "./lifecycle";
import { RuntimeMetrics, type MetricsCounts, type RuntimeMetricsSnapshot } from "./metrics";
import type { Requester } from "./permissions";
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
  /** 审计日志；缺省引擎自建一份（默认容量）。宿主可注入共享实例集中观测。 */
  audit?: AuditLog;
  /** 单调时钟（毫秒）；默认 Date.now。测试注入假钟让耗时确定。 */
  clock?: () => number;
  /** 运行期变更主体；缺省 = 系统来源（全放行）。 */
  requester?: Requester;
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
  private readonly auditLog: AuditLog;
  private readonly clock: () => number;
  private readonly listeners = new Set<EngineChangeListener>();
  private readonly requester: Requester | undefined;
  private isDisposed = false;

  constructor(session: SessionState, options: EngineOptions = {}) {
    this.current = session;
    this.counter = options.metrics ?? new RuntimeMetrics();
    this.ledger = options.ledger ?? new LifecycleLedger();
    this.auditLog = options.audit ?? new AuditLog();
    this.clock = options.clock ?? Date.now;
    this.requester = options.requester;
  }

  /** 当前会话快照；只读，调用方不得改写（引擎每次 apply 换新快照，不做原地修改）。 */
  get session(): SessionState {
    return this.current;
  }

  /** 当前指标快照；version 用当前会话的文档版本填。 */
  get metrics(): RuntimeMetricsSnapshot {
    return this.counter.snapshot(this.current.document.version);
  }

  /** 审计日志本体：宿主 / 开发面板读 `entries()`，也可 `clear()`。 */
  get audit(): AuditLog {
    return this.auditLog;
  }

  /** 记一次渲染（DocumentView 每次重画时调）；dispose 后引擎收口，不再计数。 */
  noteRender(): void {
    if (this.isDisposed) {
      return;
    }
    this.counter.count({ renders: 1 });
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
    const start = this.clock();
    // 先解析一次拿 op 条数（指标按批量总条数计，route 也算）；applySessionOps 会再解析
    // 一遍归一化后的批次，形状校验幂等，这点成本换「指标不依赖内部解析产物」。
    const parsed = parseOps(batch);
    if (!parsed.ok) {
      return this.reject(parsed.diagnostics, this.elapsed(start));
    }
    const applied = applySessionOps(this.current, parsed.batch, this.requesterOptions());
    if (!applied.ok) {
      return this.reject(applied.diagnostics, this.elapsed(start));
    }
    return this.publish(
      applied.session,
      applied.changed,
      { opsBatches: 1, opsCount: parsed.batch.ops.length },
      [],
      this.elapsed(start),
    );
  }

  /** 应用一条数据更新（标量 / 集合全量 / 集合增量）；条目级坏数据只丢自己并记诊断。 */
  applyData(payload: unknown): EngineApplyResult {
    if (this.isDisposed) {
      return this.disposedFailure();
    }
    const start = this.clock();
    // session.data 由文档校验 + 深拷而来，形状就是数据文档投影；纯函数层只读它。
    const applied = applyDataUpdate(
      this.current.document,
      this.current.data as DataState,
      payload,
      this.requesterOptions(),
    );
    if (!applied.ok) {
      return this.reject(applied.diagnostics, this.elapsed(start));
    }
    const next: SessionState = {
      document: applied.document,
      pages: this.current.pages,
      active: this.current.active,
      data: applied.data,
    };
    return this.publish(
      next,
      applied.changed,
      { dataUpdates: 1 },
      applied.diagnostics,
      this.elapsed(start),
    );
  }

  /** 全量替换整份会话并重新水合集合实例；旧版本全量被 applyFull 拒绝。 */
  applyFull(value: unknown): EngineApplyResult {
    if (this.isDisposed) {
      return this.disposedFailure();
    }
    const start = this.clock();
    const replaced = applyFullDocument(this.current, value);
    if (!replaced.ok) {
      return this.reject(replaced.diagnostics, this.elapsed(start));
    }
    const hydrated = hydrateSession(replaced.session);
    if (!hydrated.ok) {
      return this.reject(hydrated.diagnostics, this.elapsed(start));
    }
    // 全量替换后整棵树都是新的；changed 用新根 id 表示「按根重画」，不逐个列实例 id。
    return this.publish(
      hydrated.session,
      [hydrated.session.document.root.id],
      { fullUpdates: 1 },
      hydrated.diagnostics,
      this.elapsed(start),
    );
  }

  /**
   * 全量 local-trees 重组：链接器按 payload 重链窗口骨架 → 换根树（版本 +1）→ 用当前
   * data 重新水合集合实例。pages / active / data 原样保留（payload 不带页面侧表）。
   *
   * changed 固定是新根 id（整棵树被替换，渲染层按根重画）；链接 / 水合失败只回诊断，
   * 会话不变。链接期权限见文件头。
   */
  applyLocalTrees(payload: unknown): EngineApplyResult {
    if (this.isDisposed) {
      return this.disposedFailure();
    }
    const start = this.clock();
    const linked = link(WINDOW_SCAFFOLD, payload, this.linkOptions());
    if (!linked.ok) {
      return this.reject(linked.diagnostics, this.elapsed(start));
    }
    const candidate: SessionState = {
      document: { root: linked.tree, version: this.current.document.version + 1 },
      pages: this.current.pages,
      active: this.current.active,
      data: this.current.data,
    };
    const hydrated = hydrateSession(candidate);
    if (!hydrated.ok) {
      return this.reject(hydrated.diagnostics, this.elapsed(start));
    }
    return this.publish(
      hydrated.session,
      [hydrated.session.document.root.id],
      { localTreeUpdates: 1 },
      hydrated.diagnostics,
      this.elapsed(start),
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

  /** 权限选项：不传 requester 时交给纯函数层用 SYSTEM_REQUESTER。 */
  private requesterOptions(): { requester?: Requester } {
    return this.requester === undefined ? {} : { requester: this.requester };
  }

  /** 链接选项：引擎带 requester 时作为每棵局部树的请求主体；缺省走链接器系统来源。 */
  private linkOptions(): LinkOptions {
    const requester = this.requester;
    if (requester === undefined) {
      return {};
    }
    return { requesterFor: () => requester };
  }

  /** 成功提交：换会话 → 记诊断 / 耗时 / 计数 → 记审计 → 按快照派发通知。 */
  private publish(
    session: SessionState,
    changed: string[],
    counts: MetricsCounts,
    diagnostics: Diagnostic[],
    elapsedMs: number,
  ): EngineApplyResult {
    this.current = session;
    this.counter.recordDiagnostics(diagnostics);
    this.counter.recordTiming(elapsedMs);
    // 派发前快照监听者：通知期间的取消从下一次 apply 起生效，通知数按快照长度计。
    const listeners = [...this.listeners];
    this.counter.count({ ...counts, notifications: listeners.length });
    this.auditApplied(changed, diagnostics);
    for (const listener of listeners) {
      try {
        listener(session, changed);
      } catch {
        // 错误隔离：单个监听者失败不拖垮 apply，也不影响其余监听者。
      }
    }
    return { ok: true, changed, session };
  }

  /** 失败结算：rejections +1，本批诊断与耗时记进指标，并记 reject / deny 审计。 */
  private reject(diagnostics: Diagnostic[], elapsedMs: number): EngineApplyResult {
    this.counter.count({ rejections: 1 });
    this.counter.recordDiagnostics(diagnostics);
    this.counter.recordTiming(elapsedMs);
    this.auditRejected(diagnostics);
    return { ok: false, diagnostics };
  }

  /** 从 apply 起表到结算的毫秒数；只结算一次 clock，测试才能按调用次数喂假钟。 */
  private elapsed(start: number): number {
    return this.clock() - start;
  }

  /** 成功审计：一条 apply 汇总 + 成功但带条目级诊断时逐条 diagnostic。 */
  private auditApplied(changed: string[], diagnostics: Diagnostic[]): void {
    this.auditLog.record({ kind: "apply", changed: changed.length });
    for (const diagnostic of diagnostics) {
      this.auditLog.record({
        kind: "diagnostic",
        code: diagnostic.code,
        owner: diagnostic.owner,
        slot: diagnostic.slot,
        message: diagnostic.message,
      });
    }
  }

  /** 失败审计：一条 reject 汇总（首条诊断）+ 含 E-PERMISSION 时逐条 deny。 */
  private auditRejected(diagnostics: Diagnostic[]): void {
    const first = diagnostics[0];
    this.auditLog.record({
      kind: "reject",
      code: first?.code,
      message: first?.message,
      changed: 0,
    });
    for (const diagnostic of diagnostics) {
      if (diagnostic.code !== "E-PERMISSION") {
        continue;
      }
      this.auditLog.record({
        kind: "deny",
        code: diagnostic.code,
        owner: diagnostic.owner,
        slot: diagnostic.slot,
        message: diagnostic.message,
        changed: 0,
      });
    }
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

/**
 * 来源模式引擎（S5）：SourceHost + EngineRuntime 的组合壳。
 *
 * EngineRuntime 本身是「一份会话 + 账本 + 指标」的编排；SourceHost 是「注册表 → 链接」
 * 的编排。两者组合成 SourceEngine：
 * - 初始：local-trees payload → host.load → 用链接结果建一份 Slot 文档 → EngineRuntime；
 * - registerSource / removeSource / applyLocalTrees：先让 host 重算权威根树，再把 host
 *   当前注册表拼成 payload 交给 EngineRuntime.applyLocalTrees（引擎负责版本/水合/指标/
 *   审计/通知）。host 与 engine 的链接各做一次（正确性优先），语义仍由链接器唯一判据。
 * - 页面侧表 / data 由创建时传入，之后与 EngineRuntime 一样保留（local-trees payload
 *   不带页面侧表）。
 *
 * 为什么用组合而不是继续往 EngineRuntime 塞方法：EngineRuntime 已贴近 400 行预算，
 * 来源模式是宿主编排而不是文档运行时语义；组合让两个边界都清楚，也方便以后替换
 * “增量重链”。
 */

import { DOCUMENT_SCHEMA, type PageEntry } from "../contract/document";
import type { RenderStats } from "../contract/render";
import { parseLocalTrees } from "../link/parse";
import { parseView } from "../link/view";
import { propUpdates } from "./view_diff";
import type { Diagnostic } from "../contract/diagnostics";
import type { LocalTree, LocalTreesPayload } from "../link/types";
import type { EngineApplyResult, EngineOptions, EngineRuntime } from "./engine";
import { createEngine, type EngineChangeListener } from "./engine";
import type { AuditLog } from "./audit";
import type { DisposeReport } from "./lifecycle";
import type { RuntimeMetricsSnapshot } from "./metrics";
import type { Requester } from "../contract/policy";
import { SourceHost, type SourceHostResult } from "./sources";
import type { SessionState } from "../engine/document/session";

/** createEngineFromLocalTrees 的可选输入：页面侧表 / 数据文档 / 文档版本 / 引擎设施。 */
export interface SourceEngineOptions extends EngineOptions {
  pages?: readonly PageEntry[];
  active?: string;
  data?: Record<string, unknown>;
  /** 初始文档版本；缺省 1（S6 主会话视图按自己单调的 version 给）。 */
  version?: number;
}

export type SourceEngineResult =
  { ok: true; engine: SourceEngine } | { ok: false; diagnostics: Diagnostic[] };

/** `applyView` 的选项：运行后来源的 owner 不随主视图全量替换消失。 */
export interface ApplyViewOptions {
  keepOwners?: readonly string[];
}

/**
 * 来源模式的更新结果：与 EngineApplyResult 同形，但成功时额外带 host 级诊断
 * （例如 remove 级联撤树时记录的死引用），失败是 host 或 engine 的原子拒绝。
 */
export type SourceApplyResult =
  | {
      ok: true;
      changed: string[];
      session: SessionState;
      diagnostics: Diagnostic[];
    }
  | { ok: false; diagnostics: Diagnostic[] };

function failure(diagnostics: Diagnostic[]): SourceApplyResult {
  return { ok: false, diagnostics };
}

/** 把 owner 排序后的注册表拼成 local-trees payload（来源模式的“全量”）。 */
function payloadOf(host: SourceHost): LocalTreesPayload {
  const trees: LocalTree[] = [];
  for (const ownerTrees of host.sources.values()) {
    trees.push(...ownerTrees);
  }
  return { kind: "local-trees", seq: 1, trees };
}

/** 由 SourceEngine 持有的组合壳：来源注册表是树结构的权威，EngineRuntime 是会话权威。 */
export class SourceEngine {
  private readonly host: SourceHost;
  private readonly inner: EngineRuntime;
  private isDisposed = false;

  constructor(host: SourceHost, inner: EngineRuntime) {
    this.host = host;
    this.inner = inner;
  }

  get session(): SessionState {
    return this.inner.session;
  }

  get metrics(): RuntimeMetricsSnapshot {
    return this.inner.metrics;
  }

  get audit(): AuditLog {
    return this.inner.audit;
  }

  /** 当前来源注册表快照（owner → 局部树数组拷贝）；来源模式专属。 */
  get sources(): ReadonlyMap<string, readonly LocalTree[]> {
    return this.host.sources;
  }

  get sourceCount(): number {
    return this.host.size;
  }

  onChange(listener: EngineChangeListener): () => void {
    return this.inner.onChange(listener);
  }

  registerCleanup(dispose: () => void): () => void {
    return this.inner.registerCleanup(dispose);
  }

  noteRender(): void {
    this.inner.noteRender();
  }

  recordRenderStats(stats: RenderStats): void {
    this.inner.recordRenderStats(stats);
  }

  /** ops / data 原样委托 EngineRuntime；来源模式不提供 applyFull（整份文档会与注册表脱节）。 */
  applyOps(batch: unknown): EngineApplyResult {
    return this.inner.applyOps(batch);
  }

  applyData(payload: unknown): EngineApplyResult {
    return this.inner.applyData(payload);
  }

  registerSource(owner: string, trees: readonly LocalTree[]): SourceApplyResult {
    if (this.isDisposed) {
      return failure([disposedDiagnostic()]);
    }
    const result = this.host.register(owner, trees);
    return this.applyHostTree(result);
  }

  removeSource(owner: string): SourceApplyResult {
    if (this.isDisposed) {
      return failure([disposedDiagnostic()]);
    }
    const result = this.host.remove(owner);
    return this.applyHostTree(result);
  }

  /**
   * 应用一份主会话视图（S6）：整组局部树重链 → 「链接结果 + 页面侧表 + 数据 + 版本」。
   * 页面 / active / data 与当前一致且树形状没变时，只提交 props update ops；
   * 其余情况（结构 / 页面 / data 变化）仍走全量替换。失败时把 host 注册表恢复到上一份。
   *
   * `keepOwners` 是运行后来源（S7）：主视图只对页面 / 导航这类主来源负责，宿主挂的
   * 来源不随视图全量替换消失；传进来的 owner 会从当前注册表原样并进新链接。
   */
  applyView(value: unknown, options: ApplyViewOptions = {}): SourceApplyResult {
    if (this.isDisposed) {
      return failure([disposedDiagnostic()]);
    }
    const parsed = parseView(value);
    if (!parsed.ok) {
      return failure(parsed.diagnostics);
    }
    const previous = payloadOf(this.host);
    const keep = new Set(options.keepOwners ?? []);
    const kept: LocalTree[] = [];
    for (const [owner, trees] of this.host.sources) {
      if (keep.has(owner)) {
        kept.push(...trees);
      }
    }
    const loaded = this.host.load([...kept, ...parsed.view.localTrees.trees]);
    if (!loaded.ok) {
      return failure(loaded.diagnostics);
    }
    const current = this.inner.session;
    const sameMeta =
      parsed.view.version > current.document.version &&
      JSON.stringify(parsed.view.pages) === JSON.stringify(current.pages) &&
      parsed.view.active === current.active &&
      JSON.stringify(parsed.view.data) === JSON.stringify(current.data);
    if (sameMeta) {
      const updates = propUpdates(current.document.root, this.host.tree);
      if (updates !== undefined) {
        const incremental = this.inner.applyOps({
          kind: "ops",
          document: current.document.version + 1,
          base: current.document.version,
          seq: parsed.view.version,
          ops: updates,
        });
        if (incremental.ok) {
          return {
            ok: true,
            changed: incremental.changed,
            session: incremental.session,
            diagnostics: loaded.diagnostics,
          };
        }
      }
    }
    const applied = this.inner.applyFull({
      schema: DOCUMENT_SCHEMA,
      document: this.host.tree,
      pages: parsed.view.pages,
      active: parsed.view.active,
      data: parsed.view.data,
      version: parsed.view.version,
    });
    if (!applied.ok) {
      // 落败的视图不能把注册表留在新状态：回到上一份局部树，诊断一起回。
      const restored = this.host.load(previous.trees);
      return failure([...applied.diagnostics, ...restored.diagnostics]);
    }
    return {
      ok: true,
      changed: applied.changed,
      session: applied.session,
      diagnostics: loaded.diagnostics,
    };
  }

  /** 线上 local-trees 全量负载：整组替换注册表后经引擎提交新树。 */
  applyLocalTrees(payload: unknown): SourceApplyResult {
    if (this.isDisposed) {
      return failure([disposedDiagnostic()]);
    }
    const parsed = parseLocalTrees(payload);
    if (!parsed.ok) {
      return failure(parsed.diagnostics);
    }
    const result = this.host.load(parsed.payload.trees);
    return this.applyHostTree(result);
  }

  /**
   * 卸载：先收口 EngineRuntime（监听 + 账本），再收口 SourceHost 自己的账本登记。
   * 幂等；返回两次账本结算的合计。
   */
  dispose(): DisposeReport {
    if (this.isDisposed) {
      return { disposed: 0, errors: [] };
    }
    this.isDisposed = true;
    const inner = this.inner.dispose();
    const host = this.host.dispose();
    return {
      disposed: inner.disposed + host.disposed,
      errors: [...inner.errors, ...host.errors],
    };
  }

  /** host 成功后：把当前注册表交给 EngineRuntime 提交新会话；失败原样回诊断。 */
  private applyHostTree(result: SourceHostResult): SourceApplyResult {
    if (!result.ok) {
      return failure(result.diagnostics);
    }
    const applied = this.inner.applyLocalTrees(payloadOf(this.host));
    if (!applied.ok) {
      return failure(applied.diagnostics);
    }
    return {
      ok: true,
      changed: applied.changed,
      session: applied.session,
      diagnostics: result.diagnostics,
    };
  }
}

function disposedDiagnostic(): Diagnostic {
  return {
    severity: "error",
    code: "E-PAYLOAD",
    message: "来源引擎已销毁（dispose），不再接受 registerSource / removeSource / applyLocalTrees",
    path: "$",
  };
}

/**
 * 从 local-trees payload 建来源模式引擎：校验 payload → host.load → 用链接结果建
 * 初始 Slot 文档（version 1，页面侧表 / data 由调用方给）→ EngineRuntime。
 * 任何一步失败都只回诊断、不建引擎；权限检查走链接期（options.requester）。
 */
export function createEngineFromLocalTrees(
  payload: unknown,
  options: SourceEngineOptions = {},
): SourceEngineResult {
  const parsed = parseLocalTrees(payload);
  if (!parsed.ok) {
    return parsed;
  }
  const requester: Requester | undefined = options.requester;
  const host = new SourceHost(requester === undefined ? {} : { requesterFor: () => requester });
  const loaded = host.load(parsed.payload.trees);
  if (!loaded.ok) {
    host.dispose();
    return { ok: false, diagnostics: loaded.diagnostics };
  }
  const created = createEngine(
    {
      schema: "dendro.ui/1",
      document: host.tree,
      pages: [...(options.pages ?? [])],
      active: options.active ?? "",
      data: { ...(options.data ?? {}) },
      version: options.version ?? 1,
    },
    options,
  );
  if (!created.ok) {
    host.dispose();
    return created;
  }
  return { ok: true, engine: new SourceEngine(host, created.engine) };
}

/**
 * 从主会话视图建来源模式引擎（S6）：局部树走链接器，页面侧表 / 数据 / 版本随视图给。
 * 校验失败只回诊断、不建引擎；之后每次视图更新用 `SourceEngine.applyView`。
 */
export function createEngineFromView(
  value: unknown,
  options: SourceEngineOptions = {},
): SourceEngineResult {
  const parsed = parseView(value);
  if (!parsed.ok) {
    return parsed;
  }
  return createEngineFromLocalTrees(parsed.view.localTrees, {
    ...options,
    pages: parsed.view.pages,
    active: parsed.view.active,
    data: parsed.view.data,
    version: parsed.view.version,
  });
}

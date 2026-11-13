/**
 * Dendrolink 引擎运行时审计日志（S4）：逐条记下 apply 的结果、拒绝、越权与诊断。
 *
 * 与指标分工：`RuntimeMetrics` 只留累计数字（多少批、多少次拒绝、耗时），回答「多少」；
 * `AuditLog` 留逐条事件（apply / reject / deny / diagnostic），回答「哪一次、为什么」。
 * 两者都由 `EngineRuntime` 在 apply 路径上写，宿主 / 开发面板读它们做观测。
 *
 * 语义：
 * - `seq` 全日志单调自增，从 1 开始；`clear()` 只清条目、不重置 seq，清空后仍能看出
 *   「这是一条新日志」，也不会和旧条目撞号。
 * - 容量上限（默认 200，构造可传）满后丢最旧条目：审计是观测不是持久化，内存有界优先，
 *   落盘交给宿主。
 * - 条目是纯数据、无时间戳：需要时间时由调用方写进 `message`（或宿主落盘时补），
 *   测试因此只依赖 seq 与内容，不依赖真实时钟。
 * - 纯模块：不碰 DOM、不读时钟、不打日志。
 */

import type { DiagnosticCode } from "../contract/diagnostics";

/** 审计事件种类：成功应用 / 整批拒绝 / 权限拒绝 / 成功但有条目级诊断。 */
export type AuditKind = "apply" | "reject" | "deny" | "diagnostic";

/** 一条审计条目（纯数据，可直接 JSON 序列化）。 */
export interface AuditEntry {
  /** 全日志单调自增序号（从 1 开始；clear 不重置）。 */
  seq: number;
  kind: AuditKind;
  /** 诊断码（reject / deny / diagnostic 通常有；apply 一般没有）。 */
  code?: DiagnosticCode;
  /** 诊断现场：slot 的 owner（deny / diagnostic 可能带）。 */
  owner?: string;
  /** 诊断现场：slot id（deny / diagnostic 可能带）。 */
  slot?: string;
  /** 补充说明；需要时间戳时由调用方写进这里。 */
  message?: string;
  /** 本次 apply 触碰的子树根个数；reject / deny 固定为 0。 */
  changed?: number;
}

/** 记一条审计需要的字段；seq 由日志分配。 */
export type AuditEntryInput = Omit<AuditEntry, "seq">;

/** 默认容量：够开发面板回看最近一段，又不至于无限涨。 */
export const DEFAULT_AUDIT_CAPACITY = 200;

/** 有界审计日志：seq 单调、满后丢最旧、entries() 给副本。 */
export class AuditLog {
  private readonly capacity: number;
  private items: AuditEntry[] = [];
  private nextSeq = 1;

  constructor(capacity: number = DEFAULT_AUDIT_CAPACITY) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError("AuditLog 容量必须是正整数: " + String(capacity));
    }
    this.capacity = capacity;
  }

  /** 当前条目数（超容量后恒为容量）。 */
  get size(): number {
    return this.items.length;
  }

  /** 追加一条审计；满容量时先丢最旧。 */
  record(input: AuditEntryInput): void {
    this.items.push({ seq: this.nextSeq, ...input });
    this.nextSeq += 1;
    if (this.items.length > this.capacity) {
      this.items.shift();
    }
  }

  /** 当前条目的副本（调用方改返回值不影响日志）；顺序为旧 → 新。 */
  entries(): AuditEntry[] {
    return this.items.map((entry) => ({ ...entry }));
  }

  /** 清空条目；seq 继续自增（见文件头）。 */
  clear(): void {
    this.items = [];
  }
}

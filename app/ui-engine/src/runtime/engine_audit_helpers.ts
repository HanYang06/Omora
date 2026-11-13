/**
 * EngineRuntime 的审计记账：成功 apply 汇总 + 条目级诊断；失败 reject + 权限 deny。
 * 拆出来只为让 engine.ts 守住行数预算；语义与 EngineRuntime 文件头的审计说明一致。
 */

import type { Diagnostic } from "../contract/diagnostics";
import type { AuditLog } from "./audit";

/** 成功审计：一条 apply 汇总 + 成功但带条目级诊断时逐条 diagnostic。 */
export function auditApplied(
  auditLog: AuditLog,
  changed: readonly string[],
  diagnostics: readonly Diagnostic[],
): void {
  auditLog.record({ kind: "apply", changed: changed.length });
  for (const diagnostic of diagnostics) {
    auditLog.record({
      kind: "diagnostic",
      code: diagnostic.code,
      owner: diagnostic.owner,
      slot: diagnostic.slot,
      message: diagnostic.message,
    });
  }
}

/** 失败审计：一条 reject 汇总（首条诊断）+ 含 E-PERMISSION 时逐条 deny。 */
export function auditRejected(auditLog: AuditLog, diagnostics: readonly Diagnostic[]): void {
  const first = diagnostics[0];
  auditLog.record({
    kind: "reject",
    code: first?.code,
    message: first?.message,
    changed: 0,
  });
  for (const diagnostic of diagnostics) {
    if (diagnostic.code !== "E-PERMISSION") {
      continue;
    }
    auditLog.record({
      kind: "deny",
      code: diagnostic.code,
      owner: diagnostic.owner,
      slot: diagnostic.slot,
      message: diagnostic.message,
      changed: 0,
    });
  }
}

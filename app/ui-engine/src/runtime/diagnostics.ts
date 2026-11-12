/**
 * 运行时诊断的构造器。
 *
 * 诊断码与结构复用 `../link/types`；这里只放构造逻辑，severity 一律 error
 * （运行时的失败码全是 E-*，W-* 属于后续的数据/绑定层）。
 */

import type { Diagnostic, DiagnosticCode } from "../link/types";

/** 造一条 error 诊断；现场字段能带就带（owner / slot / path）。 */
export function makeDiagnostic(
  code: DiagnosticCode,
  message: string,
  fields: { owner?: string; slot?: string; path?: string } = {},
): Diagnostic {
  const diagnostic: Diagnostic = { severity: "error", code, message };
  if (fields.owner !== undefined) {
    diagnostic.owner = fields.owner;
  }
  if (fields.slot !== undefined) {
    diagnostic.slot = fields.slot;
  }
  if (fields.path !== undefined) {
    diagnostic.path = fields.path;
  }
  return diagnostic;
}

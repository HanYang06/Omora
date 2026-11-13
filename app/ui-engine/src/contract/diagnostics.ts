/**
 * 契约层：诊断码、诊断结构与构造器。
 *
 * 诊断码以 docs/engine/composition.md 为准；`E-PAYLOAD` 是给“local-trees 线上形状
 * 不合法”补的码（设计文档只列了链接冲突码，交付说明里已记）。
 *
 * 构造器沿用运行时侧行为：severity 一律 error（失败码全是 E-*，W-* 属于后续的数据 /
 * 绑定层）。link/parse.ts 的排序与构造是链接期自己的实现，留在 link 侧，避免契约层
 * 反向依赖链接器。
 */

export type DiagnosticSeverity = "error" | "warning";

export type DiagnosticCode =
  | "E-PAYLOAD"
  | "E-VERSION"
  | "E-TEMPLATE"
  | "E-ID-DUPLICATE"
  | "E-SLOT-AMBIGUOUS"
  | "E-SLOT-CAPACITY"
  | "E-TARGET-MISSING"
  | "E-CYCLE"
  | "E-PERMISSION";

/** 一条编译诊断；现场字段能带就带（owner / slot / path）。 */
export interface Diagnostic {
  severity: DiagnosticSeverity;
  code: DiagnosticCode;
  message: string;
  owner?: string;
  slot?: string;
  path?: string;
}

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

/**
 * Dendrolink 链接期编译器（S2）的类型。
 *
 * 诊断码以 docs/engine/composition.md 为准；`E-PAYLOAD` 是给“local-trees
 * 线上形状不合法”补的码（设计文档只列了链接冲突码，交付说明里已记）。
 */

import type { SlotNode } from "../core/document";

export type DiagnosticSeverity = "error" | "warning";

export type DiagnosticCode =
  | "E-PAYLOAD"
  | "E-ID-DUPLICATE"
  | "E-SLOT-AMBIGUOUS"
  | "E-SLOT-CAPACITY"
  | "E-TARGET-MISSING"
  | "E-CYCLE";

/** 一条编译诊断；现场字段能带就带（owner / slot / path）。 */
export interface Diagnostic {
  severity: DiagnosticSeverity;
  code: DiagnosticCode;
  message: string;
  owner?: string;
  slot?: string;
  path?: string;
}

/**
 * 一棵局部树。
 *
 * 线上 `replace` 只在 true 时出现（见共享 fixture）；解析后归一成布尔，
 * 保证调用方拿到的形状固定。
 */
export interface LocalTree {
  owner: string;
  root: SlotNode;
  mountAt: string;
  order: number;
  seq: number;
  replace: boolean;
}

/** `{kind:'local-trees'}` 全量重组 payload。 */
export interface LocalTreesPayload {
  kind: "local-trees";
  seq: number;
  trees: LocalTree[];
}

/** 解析结果：要么拿到归一化的 payload，要么拿到诊断（不抛）。 */
export type ParseLocalTreesResult =
  { ok: true; payload: LocalTreesPayload } | { ok: false; diagnostics: Diagnostic[] };

/** 链接结果：成功给权威根树 + id 索引；失败只给诊断，不产出半成品树。 */
export type LinkResult =
  | { ok: true; tree: SlotNode; ids: Map<string, SlotNode> }
  | { ok: false; diagnostics: Diagnostic[] };

/**
 * Dendrolink 链接期编译器（S2）的类型。
 *
 * 诊断码以 docs/engine/composition.md 为准；`E-PAYLOAD` 是给“local-trees
 * 线上形状不合法”补的码（设计文档只列了链接冲突码，交付说明里已记）。
 */

import type { SlotNode } from "../contract/document";

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

/**
 * 链接期权限主体。
 *
 * 形状与 `runtime/permissions.ts` 的 `Requester` 一致（结构类型，两边的对象可互换）；
 * 定义在 link 里，是为了不让 `link/types.ts`（runtime 的类型依赖）反向 import runtime。
 */
export interface Requester {
  owner: string;
  tiers?: readonly string[];
  roles?: readonly string[];
}

/** `link()` 的可选参数。 */
export interface LinkOptions {
  /**
   * 每棵局部树的请求主体；不传 / 返回 undefined = 系统来源（全放行）。
   *
   * 链接期只检查"来源能不能往目标 slot 挂/替换"（permissions.md §4 组合/链接期检查点），
   * 检查点在 attach 阶段：目标不存在、歧义等结构错误已经先报。
   */
  requesterFor?: (tree: LocalTree) => Requester;
}

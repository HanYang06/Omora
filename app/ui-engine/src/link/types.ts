/**
 * Dendrolink 链接期编译器（S2）的类型：局部树、payload、链接结果与链接选项。
 *
 * 诊断码与诊断结构在 contract/diagnostics；这里只保留链接器自己产出的形状。
 */

import type { Diagnostic } from "../contract/diagnostics";
import type { SlotNode } from "../contract/document";
import type { Requester } from "../contract/policy";

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

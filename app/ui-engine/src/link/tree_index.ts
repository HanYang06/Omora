/**
 * 链接器的树工具：id 索引、深度、根形状校验。
 *
 * 索引包含所有可寻址节点（children 递归 + collection.templates），
 * 与 runtime 的“全寻址”约定一致。
 */

import { DOCUMENT_SCHEMA, DocumentError, parseDocument, type SlotNode } from "../contract/document";
import type { Diagnostic, DiagnosticCode } from "./types";

/** 文本比较：不依赖 locale，保证诊断与排序确定。 */
export function compareText(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

export function indexNode(node: SlotNode, index: Map<string, SlotNode>): void {
  index.set(node.id, node);
  for (const child of node.children) {
    indexNode(child, index);
  }
  if (node.collection !== undefined) {
    for (const template of Object.values(node.collection.templates)) {
      indexNode(template, index);
    }
  }
}

export function indexInto(root: SlotNode): Map<string, SlotNode> {
  const index = new Map<string, SlotNode>();
  indexNode(root, index);
  return index;
}

export function unindex(node: SlotNode, index: Map<string, SlotNode>): void {
  index.delete(node.id);
  for (const child of node.children) {
    unindex(child, index);
  }
  if (node.collection !== undefined) {
    for (const template of Object.values(node.collection.templates)) {
      unindex(template, index);
    }
  }
}

export function assignDepths(node: SlotNode, depth: number, depths: Map<string, number>): void {
  depths.set(node.id, depth);
  for (const child of node.children) {
    assignDepths(child, depth + 1, depths);
  }
  if (node.collection !== undefined) {
    for (const template of Object.values(node.collection.templates)) {
      assignDepths(template, depth + 1, depths);
    }
  }
}

export type NormalizedRoot = { ok: true; root: SlotNode } | { ok: false; diagnostic: Diagnostic };

/**
 * 校验并归一化单棵树（base）：返回 parseDocument 归一后的根树。
 *
 * 归一很重要：base 可能在线上是扁平 grant 形状，权限检查器读的是内部
 * `{capabilities}` 形状；不归一就会把 base 上的 grant 读丢（受限来源被误拒）。
 * 失败给一条诊断。
 */
export function normalizeRoot(value: unknown, path: string): NormalizedRoot {
  try {
    const document = parseDocument({
      schema: DOCUMENT_SCHEMA,
      document: value,
      pages: [],
      active: "",
      data: {},
      version: 1,
    });
    return { ok: true, root: document.document };
  } catch (error) {
    if (!(error instanceof DocumentError)) {
      throw error;
    }
    const code: DiagnosticCode = error.code === "duplicate_id" ? "E-ID-DUPLICATE" : "E-PAYLOAD";
    return {
      ok: false,
      diagnostic: {
        severity: "error",
        code,
        message: "根树形状不合法：" + error.message,
        path,
      },
    };
  }
}

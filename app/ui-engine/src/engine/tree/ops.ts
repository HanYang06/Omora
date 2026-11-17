/**
 * 树格式 V1 的更新操作（ops）：线上形状校验。
 *
 * payload：`{kind:"ops", document, base, seq, ops:[...]}`
 * - `base` 是客户端当前文档版本，`document` 必须是 `base + 1`；
 * - 一次批量按声明序应用，只涨一个版本；空 ops 合法；
 * - op 有五种：`setProps` / `mount` / `unmount` / `replace` / `data`。
 *
 * 本模块只做形状校验（失败给稳定排序的 `E-PAYLOAD`，不抛）；把 ops 应用到
 * `dendro.tree/1` 文档、维护索引、原子回滚与 `E-VERSION` 判定在应用端（下一步）。
 *
 * 节点载荷仍用 `dendro.tree/1` 的 node 形状（带 chain）：ops 是“按 id 改文档”，
 * 不是另造一套节点。节点与目标父链的一致性由应用端校验。
 */

import { validateTree } from "../../contract/tree";
import type { Node } from "../../contract/tree_generated";

export interface SetPropsOp {
  op: "setProps";
  id: string;
  props: Record<string, unknown>;
}

export interface MountOp {
  op: "mount";
  parent: string;
  node: Node;
}

export interface UnmountOp {
  op: "unmount";
  id: string;
}

export interface ReplaceOp {
  op: "replace";
  id: string;
  node: Node;
}

export interface DataOp {
  op: "data";
  source: string;
  revision: number;
  value?: unknown;
  items?: Record<string, unknown>[];
  changes?: Record<string, unknown>[];
}

export type WireOp = SetPropsOp | MountOp | UnmountOp | ReplaceOp | DataOp;

export interface OpsBatch {
  kind: "ops";
  document: number;
  base: number;
  seq: number;
  ops: WireOp[];
}

export type OpsDiagnosticCode = "E-PAYLOAD" | "E-VERSION";

/** 一条 ops 诊断；path 是 payload 的 JSON Pointer（根为 ""）。 */
export interface OpsDiagnostic {
  code: OpsDiagnosticCode;
  path: string;
  message: string;
}

export type ParseOpsResult =
  { ok: true; batch: OpsBatch } | { ok: false; diagnostics: OpsDiagnostic[] };

const ID = /^[0-9a-f]{16}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && Number.isSafeInteger(value);
}

function failed(path: string, message: string): OpsDiagnostic {
  return { code: "E-PAYLOAD", path, message };
}

function idOf(value: unknown): string | null {
  if (typeof value !== "string" || ID.test(value) === false) {
    return null;
  }
  return value;
}

/** 节点载荷：走同一份树 schema 的 node 形状；形状错误折成 E-PAYLOAD。 */
function nodeOf(value: unknown, path: string): { node: Node } | { diagnostic: OpsDiagnostic } {
  const shape = validateTree(value, "node");
  if (shape.length > 0) {
    const first = shape[0];
    return {
      diagnostic: failed(
        path + (first?.path ?? ""),
        "节点形状不合法：" + (first?.message ?? "unknown"),
      ),
    };
  }
  return { node: value as Node };
}

function objectsOf(value: unknown): Record<string, unknown>[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const out: Record<string, unknown>[] = [];
  for (const item of value) {
    if (!isRecord(item)) {
      return null;
    }
    out.push(item);
  }
  return out;
}

function parseOp(value: unknown, index: number): { op: WireOp } | { diagnostics: OpsDiagnostic[] } {
  const path = "/ops/" + String(index);
  if (!isRecord(value)) {
    return { diagnostics: [failed(path, "op 必须是对象")] };
  }
  switch (value.op) {
    case "setProps": {
      const id = idOf(value.id);
      if (id === null) {
        return { diagnostics: [failed(path + "/id", "id 必须是 16 位小写十六进制")] };
      }
      if (!isRecord(value.props)) {
        return { diagnostics: [failed(path + "/props", "props 必须是对象")] };
      }
      return { op: { op: "setProps", id, props: value.props } };
    }
    case "mount": {
      const parent = idOf(value.parent);
      if (parent === null) {
        return { diagnostics: [failed(path + "/parent", "parent 必须是 16 位小写十六进制")] };
      }
      const node = nodeOf(value.node, path + "/node");
      if ("diagnostic" in node) {
        return { diagnostics: [node.diagnostic] };
      }
      return { op: { op: "mount", parent, node: node.node } };
    }
    case "unmount": {
      const id = idOf(value.id);
      if (id === null) {
        return { diagnostics: [failed(path + "/id", "id 必须是 16 位小写十六进制")] };
      }
      return { op: { op: "unmount", id } };
    }
    case "replace": {
      const id = idOf(value.id);
      if (id === null) {
        return { diagnostics: [failed(path + "/id", "id 必须是 16 位小写十六进制")] };
      }
      const node = nodeOf(value.node, path + "/node");
      if ("diagnostic" in node) {
        return { diagnostics: [node.diagnostic] };
      }
      return { op: { op: "replace", id, node: node.node } };
    }
    case "data": {
      return parseDataOp(value, path);
    }
    default:
      return { diagnostics: [failed(path + "/op", "未知的 op: " + String(value.op))] };
  }
}

function parseDataOp(
  value: Record<string, unknown>,
  path: string,
): { op: DataOp } | { diagnostics: OpsDiagnostic[] } {
  const diagnostics: OpsDiagnostic[] = [];
  if (typeof value.source !== "string" || value.source.trim() === "") {
    diagnostics.push(failed(path + "/source", "source 必须是非空字符串"));
  }
  if (!isInt(value.revision) || value.revision < 0) {
    diagnostics.push(failed(path + "/revision", "revision 必须是 >= 0 的 int"));
  }
  const supplied = [
    value.value !== undefined,
    value.items !== undefined,
    value.changes !== undefined,
  ].filter(Boolean).length;
  if (supplied !== 1) {
    diagnostics.push(failed(path, "data 必须且只能有 value / items / changes 之一"));
  }
  const items = value.items === undefined ? undefined : objectsOf(value.items);
  if (value.items !== undefined && items === null) {
    diagnostics.push(failed(path + "/items", "items 必须是对象数组"));
  }
  const changes = value.changes === undefined ? undefined : objectsOf(value.changes);
  if (value.changes !== undefined && changes === null) {
    diagnostics.push(failed(path + "/changes", "changes 必须是对象数组"));
  }
  if (diagnostics.length > 0) {
    return { diagnostics };
  }
  return {
    op: {
      op: "data",
      source: value.source as string,
      revision: value.revision as number,
      ...(items === undefined || items === null ? {} : { items }),
      ...(changes === undefined || changes === null ? {} : { changes }),
      ...(value.value === undefined ? {} : { value: value.value }),
    },
  };
}

function compareDiagnostics(left: OpsDiagnostic, right: OpsDiagnostic): number {
  if (left.path !== right.path) {
    return left.path < right.path ? -1 : 1;
  }
  if (left.code !== right.code) {
    return left.code < right.code ? -1 : 1;
  }
  return left.message < right.message ? -1 : left.message > right.message ? 1 : 0;
}

/** 解析 ops payload；失败返回按 (path, code, message) 排序的诊断。 */
export function parseOps(value: unknown): ParseOpsResult {
  if (!isRecord(value)) {
    return { ok: false, diagnostics: [failed("", "ops payload 必须是对象")] };
  }
  const diagnostics: OpsDiagnostic[] = [];
  if (value.kind !== "ops") {
    diagnostics.push(failed("/kind", 'kind 必须是 "ops"'));
  }
  const document = value.document;
  const base = value.base;
  const seq = value.seq;
  if (!isInt(document)) {
    diagnostics.push(failed("/document", "document 必须是 int"));
  }
  if (!isInt(base) || base < 1) {
    diagnostics.push(failed("/base", "base 必须是 >= 1 的 int"));
  }
  if (!isInt(seq) || seq < 0) {
    diagnostics.push(failed("/seq", "seq 必须是 >= 0 的 int"));
  }
  if (isInt(document) && isInt(base) && document !== base + 1) {
    diagnostics.push(failed("/document", "document 必须等于 base + 1"));
  }
  if (!Array.isArray(value.ops)) {
    diagnostics.push(failed("/ops", "ops 必须是数组"));
    return { ok: false, diagnostics: diagnostics.sort(compareDiagnostics) };
  }
  const ops: WireOp[] = [];
  value.ops.forEach((entry, index) => {
    const parsed = parseOp(entry, index);
    if ("diagnostics" in parsed) {
      diagnostics.push(...parsed.diagnostics);
      return;
    }
    ops.push(parsed.op);
  });
  if (diagnostics.length > 0) {
    return { ok: false, diagnostics: diagnostics.sort(compareDiagnostics) };
  }
  return {
    ok: true,
    batch: {
      kind: "ops",
      document: document as number,
      base: base as number,
      seq: seq as number,
      ops,
    },
  };
}

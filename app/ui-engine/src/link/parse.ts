/**
 * `local-trees` payload 的校验器（链接期编译器第一遍）。
 *
 * 逐棵树复用 `core/document.ts` 的 `parseDocument`（不另写一套 Slot 校验），
 * 再合并做跨树校验：root.owner 必须等于 tree.owner，全局 id 唯一。
 * 失败返回诊断，不抛。
 */

import { DOCUMENT_SCHEMA, DocumentError, parseDocument, type SlotNode } from "../core/document";
import type { Diagnostic, DiagnosticCode, LocalTree, ParseLocalTreesResult } from "./types";

const PAYLOAD_CODE: DiagnosticCode = "E-PAYLOAD";

/** 造一条诊断；severity 由码前缀决定（E- error / W- warning）。 */
export function makeDiagnostic(
  code: DiagnosticCode,
  message: string,
  fields: { owner?: string; slot?: string; path?: string } = {},
): Diagnostic {
  const diagnostic: Diagnostic = {
    severity: code.startsWith("W-") ? "warning" : "error",
    code,
    message,
  };
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

/** 诊断排序：与到达顺序无关，同一组输入永远得到同一个顺序。 */
export function sortDiagnostics(diagnostics: readonly Diagnostic[]): Diagnostic[] {
  return [...diagnostics].sort(
    (left, right) =>
      compareText(left.code, right.code) ||
      compareText(left.owner, right.owner) ||
      compareText(left.slot, right.slot) ||
      compareText(left.path, right.path) ||
      compareText(left.message, right.message),
  );
}

function compareText(left: string | undefined, right: string | undefined): number {
  const first = left ?? "";
  const second = right ?? "";
  if (first === second) {
    return 0;
  }
  return first < second ? -1 : 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown, path: string, diagnostics: Diagnostic[]): string | undefined {
  if (typeof value !== "string" || value.trim() === "") {
    diagnostics.push(makeDiagnostic(PAYLOAD_CODE, "必须是非空字符串", { path }));
    return undefined;
  }
  return value;
}

function readInteger(
  value: unknown,
  path: string,
  diagnostics: Diagnostic[],
  minimum?: number,
): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    diagnostics.push(makeDiagnostic(PAYLOAD_CODE, "必须是整数", { path }));
    return undefined;
  }
  if (minimum !== undefined && value < minimum) {
    diagnostics.push(makeDiagnostic(PAYLOAD_CODE, `必须不小于 ${String(minimum)}`, { path }));
    return undefined;
  }
  return value;
}

function readReplace(value: unknown, path: string, diagnostics: Diagnostic[]): boolean | undefined {
  if (value === undefined) {
    return false;
  }
  if (typeof value !== "boolean") {
    diagnostics.push(makeDiagnostic(PAYLOAD_CODE, "必须是布尔值", { path }));
    return undefined;
  }
  return value;
}

interface LocatedId {
  id: string;
  path: string;
}

/**
 * 收集一棵树里所有可寻址节点：children 递归，collection.templates 也遍历。
 * path 相对树根（根是空串），用于诊断定位。
 */
export function collectIds(root: SlotNode): LocatedId[] {
  const located: LocatedId[] = [];
  walkIds(root, "", located);
  return located;
}

function walkIds(node: SlotNode, path: string, located: LocatedId[]): void {
  located.push({ id: node.id, path });
  node.children.forEach((child, index) => {
    walkIds(child, `${path}.children[${String(index)}]`, located);
  });
  if (node.collection !== undefined) {
    for (const [name, template] of Object.entries(node.collection.templates)) {
      walkIds(template, `${path}.collection.templates.${name}`, located);
    }
  }
}

function parseRoot(
  value: unknown,
  path: string,
  owner: string | undefined,
  diagnostics: Diagnostic[],
): SlotNode | undefined {
  if (!isRecord(value)) {
    diagnostics.push(makeDiagnostic(PAYLOAD_CODE, "root 必须是对象", { owner, path }));
    return undefined;
  }
  try {
    const document = parseDocument({
      schema: DOCUMENT_SCHEMA,
      document: value,
      pages: [],
      active: "",
      data: {},
      version: 1,
    });
    const root = document.document;
    if (owner !== undefined && root.owner !== owner) {
      diagnostics.push(
        makeDiagnostic(
          PAYLOAD_CODE,
          `root.owner 必须等于 tree.owner（${owner}），实际是 ${root.owner}`,
          { owner, path: path + ".owner" },
        ),
      );
      return undefined;
    }
    return root;
  } catch (error) {
    if (!(error instanceof DocumentError)) {
      throw error;
    }
    const code: DiagnosticCode = error.code === "duplicate_id" ? "E-ID-DUPLICATE" : PAYLOAD_CODE;
    const rootPath = error.path.startsWith("$.document")
      ? error.path.slice("$.document".length)
      : error.path;
    diagnostics.push(
      makeDiagnostic(code, "槽位形状不合法：" + error.message, {
        owner,
        path: path + rootPath,
      }),
    );
    return undefined;
  }
}

/** 相同局部树重复到达时去重：链接结果必须幂等。 */
function dedupeTrees(trees: readonly LocalTree[]): LocalTree[] {
  const unique: LocalTree[] = [];
  const seen = new Set<string>();
  for (const tree of trees) {
    const key = JSON.stringify(tree);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(tree);
  }
  return unique;
}

/** 校验 `local-trees` payload；失败返回诊断（不抛）。 */
export function parseLocalTrees(value: unknown): ParseLocalTreesResult {
  const diagnostics: Diagnostic[] = [];
  if (!isRecord(value)) {
    return {
      ok: false,
      diagnostics: [makeDiagnostic(PAYLOAD_CODE, "payload 必须是对象", { path: "$" })],
    };
  }
  if (value.kind !== "local-trees") {
    diagnostics.push(makeDiagnostic(PAYLOAD_CODE, "kind 必须是 local-trees", { path: "$.kind" }));
  }
  const seq = readInteger(value.seq, "$.seq", diagnostics, 0);
  const rawTrees = value.trees;
  if (!Array.isArray(rawTrees)) {
    diagnostics.push(makeDiagnostic(PAYLOAD_CODE, "trees 必须是数组", { path: "$.trees" }));
    return { ok: false, diagnostics: sortDiagnostics(diagnostics) };
  }
  const trees: LocalTree[] = [];
  rawTrees.forEach((rawTree, index) => {
    const path = `$.trees[${String(index)}]`;
    if (!isRecord(rawTree)) {
      diagnostics.push(makeDiagnostic(PAYLOAD_CODE, "局部树必须是对象", { path }));
      return;
    }
    const owner = readString(rawTree.owner, path + ".owner", diagnostics);
    const mountAt = readString(rawTree.mountAt, path + ".mountAt", diagnostics);
    const order = readInteger(rawTree.order, path + ".order", diagnostics);
    const treeSeq = readInteger(rawTree.seq, path + ".seq", diagnostics);
    const replace = readReplace(rawTree.replace, path + ".replace", diagnostics);
    const root = parseRoot(rawTree.root, path + ".root", owner, diagnostics);
    if (
      owner === undefined ||
      mountAt === undefined ||
      order === undefined ||
      treeSeq === undefined ||
      replace === undefined ||
      root === undefined
    ) {
      return;
    }
    trees.push({ owner, root, mountAt, order, seq: treeSeq, replace });
  });
  if (diagnostics.length > 0 || seq === undefined) {
    return { ok: false, diagnostics: sortDiagnostics(diagnostics) };
  }
  const unique = dedupeTrees(trees);
  const ownersById = new Map<string, { owner: string; path: string }>();
  unique.forEach((tree, index) => {
    for (const located of collectIds(tree.root)) {
      const first = ownersById.get(located.id);
      const treePath = `$.trees[${String(index)}].root${located.path}`;
      if (first !== undefined) {
        diagnostics.push(
          makeDiagnostic(
            "E-ID-DUPLICATE",
            `重复 id: ${located.id}（${first.owner} 与 ${tree.owner}）`,
            { owner: tree.owner, slot: tree.mountAt, path: treePath },
          ),
        );
        continue;
      }
      ownersById.set(located.id, { owner: tree.owner, path: treePath });
    }
  });
  if (diagnostics.length > 0) {
    return { ok: false, diagnostics: sortDiagnostics(diagnostics) };
  }
  return { ok: true, payload: { kind: "local-trees", seq, trees: unique } };
}

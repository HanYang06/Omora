/**
 * 挂载前校验：形状走 `contract/tree.ts`（ajv + 生成 schema），再补一条 runtime
 * 自己离不开的语义检查——id 唯一。runtime 用 id 定位已挂载节点，重复 id 会让复用 /
 * 替换发生覆盖，所以必须在碰宿主之前拒绝。
 *
 * 其余语义（chain 与父链一致、同级 order、页面 / ledger 引用）由 Python 语义层在
 * compose 时保证；这一层不重复实现，也不做组合。
 */

import type { Document as TreeDocument, Node as TreeNode } from "../../contract/tree_generated";
import { validateTree } from "../../contract/tree";
import type { TreeRuntimeDiagnostic } from "./types";

export type TreeDocumentCheck =
  { ok: true; document: TreeDocument } | { ok: false; diagnostics: TreeRuntimeDiagnostic[] };

/** 校验一份待挂载的文档；合法返回归一后的文档，不合法返回稳定排序的诊断。 */
export function validateDocument(value: unknown): TreeDocumentCheck {
  const shape = validateTree(value, "document");
  if (shape.length > 0) {
    return {
      ok: false,
      diagnostics: shape.map((diagnostic): TreeRuntimeDiagnostic => {
        return {
          code: diagnostic.code,
          path: diagnostic.path,
          message: diagnostic.message,
        };
      }),
    };
  }
  const document = value as TreeDocument;
  const duplicates = duplicateIdDiagnostics(document);
  if (duplicates.length > 0) {
    return { ok: false, diagnostics: duplicates };
  }
  return { ok: true, document };
}

/** 前序遍历找第二个及以后出现的 id；按 path 排序，结果与遍历偶然顺序无关。 */
function duplicateIdDiagnostics(document: TreeDocument): TreeRuntimeDiagnostic[] {
  const seen = new Set<string>();
  const duplicates: TreeRuntimeDiagnostic[] = [];
  const visit = (node: TreeNode, path: string): void => {
    if (seen.has(node.id)) {
      duplicates.push({
        code: "E-TREE-DUP-ID",
        path: path + "/id",
        message: "重复 id: " + node.id,
      });
    } else {
      seen.add(node.id);
    }
    node.layout.forEach((child, index) => {
      visit(child, path + "/layout/" + index);
    });
  };
  visit(document.root, "/root");
  return duplicates.sort(compareDiagnostics);
}

function compareDiagnostics(left: TreeRuntimeDiagnostic, right: TreeRuntimeDiagnostic): number {
  if (left.path !== right.path) {
    return left.path < right.path ? -1 : 1;
  }
  if (left.code !== right.code) {
    return left.code < right.code ? -1 : 1;
  }
  return left.message < right.message ? -1 : left.message > right.message ? 1 : 0;
}

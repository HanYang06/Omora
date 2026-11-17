/**
 * Dendrolink 树格式 V1：形状校验（JSON Schema 2020-12）。
 *
 * `schema/tree/tree.schema.json` 是形状的单一来源；本模块只把 ajv 的原始错误折叠成
 * 稳定的 shape 诊断，不重复实现语义。V1 的语义权威在 Python
 * （`app/sdk/omora/sdk/tree.py`）：chain 与父链一致、id/chain 唯一、同级 order
 * 唯一且升序、页面 / ledger 引用、非 layout 字段不得藏节点（collection.templates
 * 是具名模板表，里面的节点合法）——TS 侧不做这些检查。
 *
 * 诊断码映射：
 * - pattern 命中 `$defs/id` -> E-TREE-ID
 * - pattern 命中 `$defs/chain` -> E-TREE-CHAIN
 * - enum 在 `/mount/mode` -> E-TREE-MOUNT
 * - const 在 `/root/kind` -> E-TREE-ROOT
 * - 其余（required / additionalProperties / type / ...）-> E-TREE-PAYLOAD
 *
 * 诊断稳定：按 path 升序（同 path 再按 code、message），与 ajv 的产出顺序无关。
 */

import Ajv2020 from "ajv/dist/2020";
import type { AnySchema, ErrorObject, ValidateFunction } from "ajv";
import { TREE_SCHEMA, TREE_SCHEMA_ID } from "./tree_generated";

/** 顶层 `oneOf` 的三个结构角色；分别对应 `$defs/` 下的同名 schema。 */
export type TreeShape = "document" | "partial" | "node";

export type TreeDiagnosticCode =
  "E-TREE-ID" | "E-TREE-CHAIN" | "E-TREE-MOUNT" | "E-TREE-ROOT" | "E-TREE-PAYLOAD";

/** 一条 shape 诊断；path 是出错实例的 JSON Pointer（根为 `""`）。 */
export interface TreeDiagnostic {
  code: TreeDiagnosticCode;
  path: string;
  message: string;
}

// strict: false 关掉对未知关键字的告警——schema 顶层的 `x-omora` 是给生成器的扩展，
// 不是 JSON Schema 关键字。
const ajv = new Ajv2020({ allErrors: true, strict: false });
ajv.addSchema(TREE_SCHEMA as AnySchema, TREE_SCHEMA_ID);

function validatorFor(shape: TreeShape): ValidateFunction {
  const ref = TREE_SCHEMA_ID + "#/$defs/" + shape;
  const validate = ajv.getSchema(ref);
  if (validate === undefined) {
    throw new Error("树 schema 缺少 " + ref);
  }
  return validate;
}

// 模块初始化就取好三个 validator；schema 与 TREE_SCHEMA_ID 脱节时立刻炸，不留到调用期。
const VALIDATORS: Record<TreeShape, ValidateFunction> = {
  document: validatorFor("document"),
  partial: validatorFor("partial"),
  node: validatorFor("node"),
};

function codeOf(error: ErrorObject): TreeDiagnosticCode {
  if (error.keyword === "pattern") {
    if (error.schemaPath.includes("/$defs/id/")) {
      return "E-TREE-ID";
    }
    if (error.schemaPath.includes("/$defs/chain/")) {
      return "E-TREE-CHAIN";
    }
  } else if (error.keyword === "enum" && error.instancePath === "/mount/mode") {
    return "E-TREE-MOUNT";
  } else if (error.keyword === "const" && error.instancePath === "/root/kind") {
    return "E-TREE-ROOT";
  }
  return "E-TREE-PAYLOAD";
}

function compareDiagnostics(left: TreeDiagnostic, right: TreeDiagnostic): number {
  if (left.path !== right.path) {
    return left.path < right.path ? -1 : 1;
  }
  if (left.code !== right.code) {
    return left.code < right.code ? -1 : 1;
  }
  return left.message < right.message ? -1 : left.message > right.message ? 1 : 0;
}

/**
 * 按结构角色校验一棵树；合法返回空数组，不合法返回按 path 排序的 shape 诊断。
 * 只校验 JSON Schema 能表达的形状，语义留给 Python。
 */
export function validateTree(value: unknown, shape: TreeShape): TreeDiagnostic[] {
  const validate = VALIDATORS[shape];
  if (validate(value)) {
    return [];
  }
  const diagnostics = (validate.errors ?? []).map((error): TreeDiagnostic => {
    return {
      code: codeOf(error),
      path: error.instancePath,
      message: error.message ?? error.keyword,
    };
  });
  return diagnostics.sort(compareDiagnostics);
}

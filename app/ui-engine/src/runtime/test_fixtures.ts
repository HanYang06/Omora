/**
 * runtime 测试的共享支持：读共享 ops fixture、造节点 / 状态 / 批量。
 * 只在测试里 import，不属于运行时模块图。
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { SlotNode } from "../core/document";
import { createState, type DocumentState } from "./document";
import { parseOps, type ApplyOpsResult, type OpsBatch } from "./ops";

export const OPS_FIXTURE_PATH = fileURLToPath(
  new URL("../../../sdk/tests/fixtures/ops.json", import.meta.url),
);

export function readOpsFixture(): unknown {
  const value: unknown = JSON.parse(readFileSync(OPS_FIXTURE_PATH, "utf8"));
  return value;
}

export function node(over: Partial<SlotNode> & { id: string }): SlotNode {
  return { kind: "dendro:slot", owner: "test", props: {}, children: [], ...over };
}

export function stateOf(root: SlotNode, version = 1): DocumentState {
  const created = createState(root, version);
  if (!created.ok) {
    throw new Error("测试根树应合法: " + JSON.stringify(created.diagnostics));
  }
  return created.state;
}

export function batchOf(ops: unknown[]): OpsBatch {
  const parsed = parseOps({ kind: "ops", document: 17, base: 16, seq: 1, ops });
  if (!parsed.ok) {
    throw new Error("测试 ops 应能解析: " + JSON.stringify(parsed.diagnostics));
  }
  return parsed.batch;
}

export function expectApplied(result: ApplyOpsResult): Extract<ApplyOpsResult, { ok: true }> {
  if (!result.ok) {
    throw new Error("ops 应应用成功: " + JSON.stringify(result.diagnostics));
  }
  return result;
}

/** 断言失败并返回诊断清单；测试里用来钉诊断码与现场。 */
export function expectFailed(result: ApplyOpsResult) {
  if (result.ok) {
    throw new Error("ops 应应用失败");
  }
  return result.diagnostics;
}

/**
 * 链接器测试的共享支持：读共享 fixture、造局部树 / payload / 槽位。
 * 只在测试里 import，不属于运行时模块图。
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { SlotNode } from "../core/document";
import { parseLocalTrees } from "./parse";
import type { LinkResult, LocalTree, LocalTreesPayload } from "./types";

export const FIXTURE_PATH = fileURLToPath(
  new URL("../../../sdk/tests/fixtures/local-trees.json", import.meta.url),
);

export function readFixture(): unknown {
  const value: unknown = JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));
  return value;
}

/** 共享 fixture 解析后的归一化 payload；失败直接抛（fixture 是契约）。 */
export function fixturePayload(): LocalTreesPayload {
  const parsed = parseLocalTrees(readFixture());
  if (!parsed.ok) {
    throw new Error("共享 fixture 应能解析: " + JSON.stringify(parsed.diagnostics));
  }
  return parsed.payload;
}

export function slot(over: Partial<SlotNode> & { id: string }): SlotNode {
  return {
    kind: "dendro:slot",
    owner: "test",
    props: {},
    children: [],
    ...over,
  };
}

export function tree(over: Partial<LocalTree> & { root: SlotNode }): LocalTree {
  return {
    owner: "test",
    mountAt: "dendro.window.page",
    order: 0,
    seq: 0,
    replace: false,
    ...over,
  };
}

export function payloadOf(trees: LocalTree[], seq = 1): LocalTreesPayload {
  return { kind: "local-trees", seq, trees };
}

/** 断言链接成功并返回 ok 分支，避免测试里到处写 if (!result.ok)。 */
export function expectLinked(result: LinkResult) {
  if (!result.ok) {
    throw new Error("应链接成功: " + JSON.stringify(result.diagnostics));
  }
  return result;
}

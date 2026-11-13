/**
 * Dendrolink 权限薄层（S4）：能力 × 主体的 grant 检查。
 *
 * 语义按 `docs/engine/permissions.md`：
 * - 系统来源（tier 含 `system`）默认全能力；slot 的 owner 对自己的子树全能力；
 * - 其他主体只能靠 slot.grant.capabilities[capability] 里的 token 获得能力：
 *   `any` / `owner` / `owner:<id>` / `role:<name>` / `tier:<name>` / 裸 token 当 owner id；
 * - 没有 grant、grant 里没有该能力、token 无法识别 → 一律拒绝。
 *
 * 这一层只回答「行不行」与「怎么拒绝」，不做任何写操作：ops / data 在真正改树之前
 * 调它，拒绝时整批原子不生效、原状态不变（见 ops.ts / data.ts 文件头）。
 *
 * 检查点与默认分层见 permissions.md §3 / §4；本层不是安全边界（§6），只是协作 /
 * 一致性契约。
 */

import type { SlotNode } from "../contract/document";
import type { Diagnostic } from "../link/types";
import type { DocumentIndex } from "./document";
import { makeDiagnostic } from "./diagnostics";
import type { Op } from "./ops";

/** 权限能力（permissions.md §1）；`intercept` 当前只保留名字。 */
export type Capability =
  "read" | "mount" | "replace" | "update" | "remove" | "observe" | "intercept";

/** 发起一次运行期变更的主体；tiers / roles 由宿主解析后传入。 */
export interface Requester {
  owner: string;
  tiers?: readonly string[];
  roles?: readonly string[];
}

/** 系统来源（同包、受信）：默认全能力；与 `tier:system` 等价。 */
export const SYSTEM_REQUESTER: Requester = { owner: "dendro", tiers: ["system"] };

/** `applyOps` / `applyData` 的公共选项：不传 requester 等于 `SYSTEM_REQUESTER`。 */
export interface RequesterOptions {
  requester?: Requester;
}

export type PermissionCheck = { ok: true } | { ok: false; diagnostic: Diagnostic };

/** 系统 tier 全放行（permissions.md §3）。 */
function isSystem(requester: Requester): boolean {
  return requester.tiers?.includes("system") === true;
}

/**
 * 单个 grant token 是否授予主体对该 slot 的能力。
 *
 * token 形态：`any`、`owner`、`owner:<id>`、`role:<name>`、`tier:<name>`、裸 owner id。
 * 带冒号但前缀不认识、或冒号后为空 → 无法识别 → 不授予（返回 false）。
 */
function matchesToken(token: string, slot: SlotNode, requester: Requester): boolean {
  if (token === "any") {
    return true;
  }
  // requester.owner === slot.owner 已在 can() 里放行；这里保留 token 语义，行为不变。
  if (token === "owner") {
    return requester.owner === slot.owner;
  }
  const separator = token.indexOf(":");
  if (separator === -1) {
    // 裸 token 当 owner id 匹配。
    return token === requester.owner;
  }
  const kind = token.slice(0, separator);
  const name = token.slice(separator + 1);
  if (name === "") {
    return false;
  }
  switch (kind) {
    case "owner":
      return name === requester.owner;
    case "role":
      return requester.roles?.includes(name) === true;
    case "tier":
      return requester.tiers?.includes(name) === true;
    default:
      return false;
  }
}

/**
 * 主体能否对 slot 做 capability。
 *
 * 顺序固定：系统 tier → owner 本人 → grant token 列表。没有 grant / 没有该能力
 * → false。子树的继承 / 覆盖规则尚未定义（permissions.md §7），这里只看本 slot。
 */
export function can(slot: SlotNode, capability: Capability, requester: Requester): boolean {
  if (isSystem(requester)) {
    return true;
  }
  if (requester.owner === slot.owner) {
    return true;
  }
  const tokens = slot.grant?.capabilities[capability];
  if (tokens === undefined) {
    return false;
  }
  return tokens.some((token) => matchesToken(token, slot, requester));
}

/**
 * 检查一次运行期能力请求：ok 或一条 E-PERMISSION 诊断。
 *
 * 诊断消息含 capability、slot id、requester.owner；现场字段 owner = slot.owner、
 * slot = slot.id（调用方负责决定失败时批量的原子语义）。
 */
export function checkPermission(
  slot: SlotNode,
  capability: Capability,
  requester: Requester,
): PermissionCheck {
  if (can(slot, capability, requester)) {
    return { ok: true };
  }
  return {
    ok: false,
    diagnostic: makeDiagnostic(
      "E-PERMISSION",
      "requester " + requester.owner + " 没有 slot " + slot.id + " 的 " + capability + " 能力",
      { owner: slot.owner, slot: slot.id },
    ),
  };
}

/** id 所在父节点的 slot；根（或没有父）返回 undefined。模板根的父是所属 collection slot。 */
function parentSlot(index: DocumentIndex, id: string): SlotNode | undefined {
  const parent = index.parentOf(id);
  return parent === undefined ? undefined : index.get(parent.parentId);
}

/**
 * 一条 op 需要的权限，按 op 语义顺序列出（permissions.md §4 运行期检查点）：
 * - update → 目标 slot update；
 * - mount → 目标槽 mount；
 * - replace → 目标 slot replace；
 * - unmount → 父 slot remove；
 * - move → 旧父 slot remove，再新目标槽 mount。
 *
 * 目标不存在时返回空清单：结构错误（E-TARGET-MISSING / 根不能卸载等）由
 * `ops_apply.ts` 按既有语义先报，权限检查不抢在结构校验前面换掉诊断码。
 */
function requiredChecks(
  index: DocumentIndex,
  op: Op,
): ReadonlyArray<{ slot: SlotNode; capability: Capability }> {
  switch (op.op) {
    case "update": {
      const target = index.get(op.id);
      return target === undefined ? [] : [{ slot: target, capability: "update" }];
    }
    case "mount": {
      const target = index.get(op.slot);
      return target === undefined ? [] : [{ slot: target, capability: "mount" }];
    }
    case "replace": {
      const target = index.get(op.id);
      return target === undefined ? [] : [{ slot: target, capability: "replace" }];
    }
    case "unmount": {
      const parent = parentSlot(index, op.id);
      return parent === undefined ? [] : [{ slot: parent, capability: "remove" }];
    }
    case "move": {
      const source = parentSlot(index, op.id);
      const target = index.get(op.slot);
      if (source === undefined || target === undefined) {
        return [];
      }
      return [
        { slot: source, capability: "remove" },
        { slot: target, capability: "mount" },
      ];
    }
  }
}

/**
 * 按 op 语义检查一条树 op 的权限；放行返回 undefined，拒绝返回 E-PERMISSION 诊断。
 *
 * `index` 必须是 op 即将应用时的当前树索引（批量里前面的 op 可能已经改树）。
 */
export function checkOpPermission(
  index: DocumentIndex,
  op: Op,
  requester: Requester,
): Diagnostic | undefined {
  for (const check of requiredChecks(index, op)) {
    const result = checkPermission(check.slot, check.capability, requester);
    if (!result.ok) {
      return result.diagnostic;
    }
  }
  return undefined;
}

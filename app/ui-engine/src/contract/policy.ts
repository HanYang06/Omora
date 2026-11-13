/**
 * 契约层：能力 × 主体的权限策略（纯函数，不碰文档状态）。
 *
 * 语义按 `docs/engine/permissions.md`：
 * - 系统来源（tier 含 `system`）默认全能力；slot 的 owner 对自己的子树全能力；
 * - 其他主体只能靠 slot.grant.capabilities[capability] 里的 token 获得能力：
 *   `any` / `owner` / `owner:<id>` / `role:<name>` / `tier:<name>` / 裸 token 当 owner id；
 * - 没有 grant、grant 里没有该能力、token 无法识别 → 一律拒绝。
 *
 * 纯策略集中到契约层，修掉 link → runtime 的反向依赖：链接期与运行期共用同一份
 * grant token 求值。运行期的 op 检查点（按 op 找目标 slot、批量原子语义）留在
 * host/permissions.ts，不在契约层。
 *
 * 检查点与默认分层见 permissions.md §3 / §4；本层不是安全边界（§6），只是协作 /
 * 一致性契约。
 */

import { makeDiagnostic } from "./diagnostics";
import type { Diagnostic } from "./diagnostics";
import type { SlotNode } from "./document";

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
 * 检查一次能力请求：ok 或一条 E-PERMISSION 诊断。
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

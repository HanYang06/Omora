/**
 * 运行期权限检查点：按 op 语义找目标 slot，再交给 contract/policy 判能力。
 *
 * 纯策略（能力 × 主体、grant token 求值、can / checkPermission）在 contract/policy.ts，
 * 链接期与运行期共用同一份实现。这里只留 op 级编排：
 * - update → 目标 slot update；
 * - mount → 目标槽 mount；
 * - replace → 目标 slot replace；
 * - unmount → 父 slot remove；
 * - move → 旧父 slot remove，再新目标槽 mount。
 *
 * 这一层只回答「行不行」与「怎么拒绝」，不做任何写操作。engine 层不懂权限：host 用
 * 这里的 `checkOpPermission` 与 contract/policy 的 `checkPermission` 构造 guard，注入
 * engine 的 `applyOps` / `applyData`；拒绝时整批原子不生效、原状态不变。
 *
 * 检查点与默认分层见 permissions.md §3 / §4；本层不是安全边界（§6），只是协作 /
 * 一致性契约。
 */

import type { Diagnostic } from "../contract/diagnostics";
import type { SlotNode } from "../contract/document";
import { checkPermission, type Capability, type Requester } from "../contract/policy";
import type { DocumentIndex } from "../engine/document/document";
import type { Op } from "../engine/document/ops";

/**
 * 宿主侧的请求主体选项（旧 engine 答案，保留形状）：engine 的 apply 方法收 guard，
 * 不传 guard = 不做检查（等价于系统来源全放行）。
 */
export interface RequesterOptions {
  requester?: Requester;
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

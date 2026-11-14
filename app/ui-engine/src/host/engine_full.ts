/**
 * 全量替换的权限检查（S4 尾巴）：`applyFull` 的根级闸门。
 *
 * `applyFull` 是一次「整棵权威树 + 页面侧表 + 数据文档」的整体接管，权限上等价于对
 * **当前**根 slot 的 `replace`。规则（【建议】层面的最小闭合，见 permissions.md §4/§8）：
 *
 * - 只做一次根级判断，不逐 slot 检查：全量是整体接管，不是逐块改写；
 * - 判定目标是**当前**根 slot：新文档内部 slot 的 grant 不参与——否则越权方只要在
 *   自己提交的全量里写上 grant 就能自我授权；
 * - 文档形状 / 版本错误的语义不变且优先：先报 E-PAYLOAD / E-VERSION，再谈权限，
 *   与 link / ops 的「结构错误先于权限」一致；
 * - 不传 requester = 系统来源（不检查，与 EngineRuntime 其他 apply 一致）；没有当前
 *   会话（首次全量）时没有可检查的目标，放行。
 *
 * 接线：EngineRuntime.applyFull 在注入 requester 时调用本函数；整份被拒时走同一条
 * reject / deny 审计，会话与指标不动。
 */

import { checkPermission, type Requester } from "../contract/policy";
import { applyFull, type ApplyFullResult, type SessionState } from "../engine/document/session";

/**
 * 带权限检查的全量替换：先按 session 层语义校验并构造新会话（形状 / 版本错误优先），
 * 再按当前根 slot 检查 `replace`；拒绝返回 E-PERMISSION，会话与指标由 EngineRuntime 结算。
 */
export function applyFullWithPermission(
  current: SessionState | null,
  value: unknown,
  requester?: Requester,
): ApplyFullResult {
  const replaced = applyFull(current, value);
  if (!replaced.ok || current === null || requester === undefined) {
    return replaced;
  }
  const allowed = checkPermission(current.document.root, "replace", requester);
  return allowed.ok ? replaced : { ok: false, diagnostics: [allowed.diagnostic] };
}

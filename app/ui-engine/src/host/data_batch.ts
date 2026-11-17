/**
 * 一批 data payload 的原子应用：全部成功才返回新会话，任一失败整批不提交。
 *
 * 每个 payload 仍走 data.ts 的 applyData（revision 幂等 / 集合 / 绑定语义不变）；
 * 这里只负责在局部变量上串起来、去重 changed、一次设置版本，供 EngineRuntime 做
 * 单次 publish。
 */

import type { Diagnostic } from "../contract/diagnostics";
import type { SessionState } from "../engine/document/session";
import {
  applyData as applyDataUpdate,
  type DataGuard,
  type DataState,
  type ApplyDataOptions,
} from "../engine/updates/data";

export type DataBatchResult =
  | {
      ok: true;
      session: SessionState;
      changed: string[];
      diagnostics: Diagnostic[];
    }
  | { ok: false; diagnostics: Diagnostic[] };

export function applyDataBatch(
  current: SessionState,
  payloads: readonly unknown[],
  guard: DataGuard | undefined,
  version: number,
): DataBatchResult {
  const options: ApplyDataOptions = guard === undefined ? {} : { guard };
  let document = current.document;
  let data = current.data as DataState;
  const changed: string[] = [];
  const diagnostics: Diagnostic[] = [];
  for (const payload of payloads) {
    const applied = applyDataUpdate(document, data, payload, options);
    if (!applied.ok) {
      return { ok: false, diagnostics: applied.diagnostics };
    }
    document = applied.document;
    data = applied.data;
    changed.push(...applied.changed);
    diagnostics.push(...applied.diagnostics);
  }
  return {
    ok: true,
    session: {
      ...current,
      document: { ...document, version },
      data,
    },
    changed: [...new Set(changed)],
    diagnostics,
  };
}

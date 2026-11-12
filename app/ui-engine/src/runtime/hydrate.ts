/**
 * Dendrolink v2 会话水合（S3-d）：全量文档数据 → 集合实例子树。
 *
 * 会话从整份 v2 文档建出来时（`createSession`），`data` 还是线上投影
 * （`source → { revision, value | items }`），集合 slot 的 `children` 还是空的；
 * 渲染层需要的是已经按模板物化好的实例。`hydrateSession` 补的就是这一步：
 *
 * - 递归遍历 **live 根树**（`children`；`collection.templates` 只是模板表，不展开、
 *   不水合、不替换），对每个带 `collection` 的 slot，从 `session.data[collection.source]`
 *   取该 source 的投影：
 *   · 投影是 `{ items: [...] }`（`items` 是数组，空数组也算）→ 调 `instantiateCollection`
 *     整槽物化，按 id 原位替换（结构共享：没碰到的分支保留原引用）；slot id 记进
 *     `changed`，集合原语的坏条目诊断（`E-TEMPLATE` / `E-ID-DUPLICATE`）原样带出。
 *     数据可能后到，所以这一步只做「把已有数据变成实例」，不做增量维护；
 *   · source 不存在、投影是对象但没有 `items`、或 `items` 是 undefined → 数据还没到，
 *     保持原 `children` 不动，不算 changed，不报诊断；
 *   · 投影不是对象（字符串 / 数组 / null 等）或 `items` 不是数组 → 这是线上形状错误，
 *     记 `E-PAYLOAD` 诊断并保持原样（ok 仍为 true，坏数据不拖垮整棵树）。
 * - 实例化后再递归它产生的 children（支持「集合 slot 嵌套在实例化结果里」的场景；
 *   当前集合原语会把模板里的 `collection` 去掉，所以实际只会是普通节点）；
 * - 文档版本 / pages / active / data 一律不动，只换根树；根树未变时返回原 `session`
 *   引用，根树变化时返回新 `SessionState`（结构共享未改分支）。
 *
 * 幂等性：重复水合同一份输入，实例 id、层级与 props 完全一致（值幂等），但每次都会
 * 按数据重新物化，返回的是新节点引用而不是同一个引用——这是刻意的：本函数定位在
 * 「建会话时补一次全量数据」，后续增量走 `applyData` / `applySessionOps`，这里不承担
 * 无变化检测（那会与 data router 的 changed 语义分叉）。
 *
 * 纯函数：入参 `session` 与它的根树都不被改写；失败（只有 `session.data` 不是对象这种
 * 运行时不变量被破坏的情况）返回 `ok:false` 诊断，不抛。
 */

import type { SlotNode } from "../core/document";
import type { Diagnostic, DiagnosticCode } from "../link/types";
import { instantiateCollection } from "./collection";
import { makeDiagnostic } from "./diagnostics";
import type { SessionState } from "./session";

const PAYLOAD_CODE: DiagnosticCode = "E-PAYLOAD";

/** 水合结果：成功时给出（可能换了根树的）会话；失败只给诊断。 */
export type HydrateResult =
  | { ok: true; session: SessionState; changed: string[]; diagnostics: Diagnostic[] }
  | { ok: false; diagnostics: Diagnostic[] };

interface HydrateContext {
  data: Record<string, unknown>;
  changed: string[];
  diagnostics: Diagnostic[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

/** 数据投影形状错误：E-PAYLOAD，带 slot / owner / 数据路径现场。 */
function dataDiagnostic(slot: SlotNode, source: string, message: string): Diagnostic {
  return makeDiagnostic(PAYLOAD_CODE, "slot " + slot.id + " 的数据源「" + source + "」" + message, {
    owner: slot.owner,
    slot: slot.id,
    path: "$.data[" + JSON.stringify(source) + "]",
  });
}

/**
 * 读一个集合 slot 该用的条目数组。
 * undefined = 数据还没到或形状错误（形状错误已经记了诊断），调用方保持原 children。
 */
function readItems(
  slot: SlotNode,
  source: string,
  context: HydrateContext,
): readonly unknown[] | undefined {
  if (!hasOwn(context.data, source)) {
    return undefined;
  }
  const projection = context.data[source];
  if (projection === undefined) {
    return undefined;
  }
  if (!isRecord(projection)) {
    context.diagnostics.push(
      dataDiagnostic(slot, source, "的投影必须是对象（{ revision, items }）"),
    );
    return undefined;
  }
  if (!hasOwn(projection, "items")) {
    return undefined;
  }
  const items: unknown = projection.items;
  if (items === undefined) {
    return undefined;
  }
  if (!Array.isArray(items)) {
    context.diagnostics.push(dataDiagnostic(slot, source, "的 items 必须是数组"));
    return undefined;
  }
  return items as unknown[];
}

/** 递归水合一棵子树：先物化自己的集合数据，再水合（可能刚物化出来的）children。 */
function hydrateNode(slot: SlotNode, context: HydrateContext): SlotNode {
  let current = slot;
  const collection = slot.collection;
  if (collection !== undefined) {
    const items = readItems(slot, collection.source, context);
    if (items !== undefined) {
      const instantiated = instantiateCollection(slot, items);
      context.diagnostics.push(...instantiated.diagnostics);
      if (instantiated.ok) {
        current = instantiated.slot;
        context.changed.push(slot.id);
      }
      // ok:false 只会在 slot 没有 collection 时出现，而这里刚检查过，理论上到不了；
      // 真到了就保持原 children 不替换，诊断照常带出。
    }
  }
  const children = current.children.map((child) => hydrateNode(child, context));
  const childChanged = children.some((child, index) => child !== current.children[index]);
  return childChanged ? { ...current, children } : current;
}

/**
 * 把全量文档里的数据投影水合成集合实例。
 *
 * 只换根树（版本 / pages / active / data 与入参同一引用），其余语义见文件头。
 */
export function hydrateSession(session: SessionState): HydrateResult {
  if (!isRecord(session.data)) {
    return {
      ok: false,
      diagnostics: [
        makeDiagnostic(PAYLOAD_CODE, "session.data 必须是对象（source → 数据投影）", {
          path: "$.data",
        }),
      ],
    };
  }
  const context: HydrateContext = { data: session.data, changed: [], diagnostics: [] };
  const root = hydrateNode(session.document.root, context);
  const hydrated: SessionState =
    root === session.document.root
      ? session
      : { ...session, document: { ...session.document, root } };
  return {
    ok: true,
    session: hydrated,
    changed: context.changed,
    diagnostics: context.diagnostics,
  };
}

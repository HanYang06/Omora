/**
 * Dendrolink 纯数据更新路由（S3-b / S3-c）。
 *
 * 输入是一条 `{kind:"data", owner, source, revision, value | items | changes}` 负载；
 * 路由按 `source` 找到消费它的 slot，并把结果替换回根树：
 * - 标量 `value`：写进数据文档 `data[source].value`，再按 `in` / `bind` 把值解析进
 *   消费者节点的 props（选 input、解析、保留原值等语义见 `./data_bind.ts` 文件头）；
 *   props 没变的节点不替换，`changed` 只列真正被改 props 的消费者 id。
 * - 集合 `items`（全量）：`instantiateCollection` 整槽重建后原位替换（只换 slot，
 *   不换 id/位置/模板表）。
 * - 集合 `changes`（增量）：`applyCollectionChanges` 在已有条目上维护 keyed 列表，
 *   再用新条目重建每个消费该 source 的集合 slot；没有历史条目时按空列表应用。
 *
 * `owner` 只做信封校验，不参与路由（归属 / 权限由来源宿主层负责）；路由只看 `source`。
 *
 * 权限：engine 层本身不懂权限。`applyData` 接受 `options.guard`（DataGuard）——真正
 * 会被写到的消费 slot 先调一次，返回诊断即整批原子失败；不传 guard = 不做检查
 * （等价于系统来源全放行）。宿主用 contract/policy 构造 guard 注入，诊断/现场由宿主
 * 侧生成。真正会被写到的 slot：集合全量 / 增量对应消费该 source 的 collection slot；
 * 标量对应 `in` 含该 source 且 props 真的会变的消费者（没有变化的消费者不算被写）。
 * 信封不合法 / 坏条目等既有诊断语义不变。
 *
 * 多消费者：同一条 source 可被多个集合 slot 消费（`collection.source` 相同），也可被
 * 多个声明 `in` 的节点消费（标量绑定）。增量只按索引顺序用**第一个**消费者的集合配置
 * （key/select）落到条目列表上，其余消费者从同一份条目重新实例化；`changed` 按更新
 * 顺序去重列出被重建的集合 slot id 与被改 props 的消费者 id（不是条目实例 id）。
 *
 * 纯函数与原子性：
 * - 信封不合法时 `ok:false`，文档与数据都不变；
 * - 条目级坏数据按集合原语契约降级成 `ok:true` + 诊断（E-TEMPLATE / E-PAYLOAD）；
 * - revision 幂等：`payload.revision <= 当前 revision` 是 no-op（changed、诊断都为空），
 *   同 revision 重复到达不会重放；
 * - 入参不被改写；未改动的子树复用旧引用（结构共享），渲染层可按引用判断未变。
 *
 * 索引：每次替换后都从**新**根树重建 `DocumentIndex` 再按 id 定位下一个消费者，
 * 所以不存在拿旧树里的节点去替换的可能；即使某个消费者被前一次整槽重建覆盖掉
 * （集合 slot 互为祖先这种病态结构），它也不会出现在后续替换里。
 */

import type { SlotNode } from "../../contract/document";
import type { Diagnostic, DiagnosticCode } from "../../contract/diagnostics";
import {
  applyCollectionChanges,
  instantiateCollection,
  type CollectionChange,
  type CollectionItem,
} from "../collections/collection";
import { applyScalarBinding, replaceSlotById } from "./data_bind";
import { DocumentIndex, type DocumentState } from "../document/document";
import { makeDiagnostic } from "../../contract/diagnostics";

const PAYLOAD_CODE: DiagnosticCode = "E-PAYLOAD";

/** 每个被写消费者 slot 的权限闸门：返回诊断 = 拒绝（整批原子失败）；undefined = 放行。 */
export type DataGuard = (slot: SlotNode) => Diagnostic | undefined;

/** `applyData` 的选项：不传 guard = 不做权限检查（等价于系统来源全放行）。 */
export interface ApplyDataOptions {
  guard?: DataGuard;
}

/** 一条数据源在数据文档里的投影：revision 单调递增，值或条目二选一。 */
export interface DataSourceState {
  revision: number;
  value?: unknown;
  items?: CollectionItem[];
}

/** 数据文档：source → 该 source 的最新状态。 */
export type DataState = Record<string, DataSourceState>;

interface DataEnvelope {
  kind: "data";
  owner: string;
  source: string;
  revision: number;
}

/** 标量数据：`value` 可以是任意 JSON 值（包括 null / 对象）。 */
export interface ScalarDataPayload extends DataEnvelope {
  value: unknown;
}

/** 集合全量：一份完整条目列表，可作为增量对不上时的兜底。 */
export interface ItemsDataPayload extends DataEnvelope {
  items: CollectionItem[];
}

/** 集合增量：insert / update / remove / move（形状见 collection.md §5）。 */
export interface ChangesDataPayload extends DataEnvelope {
  changes: CollectionChange[];
}

export type DataPayload = ScalarDataPayload | ItemsDataPayload | ChangesDataPayload;

export type ParseDataResult =
  { ok: true; payload: DataPayload } | { ok: false; diagnostics: Diagnostic[] };

export type ApplyDataResult =
  | {
      ok: true;
      document: DocumentState;
      data: DataState;
      changed: string[];
      diagnostics: Diagnostic[];
    }
  | { ok: false; diagnostics: Diagnostic[] };

const DATA_FIELDS = ["value", "items", "changes"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function readString(value: unknown, path: string, diagnostics: Diagnostic[]): string | undefined {
  if (typeof value !== "string" || value.trim() === "") {
    diagnostics.push(makeDiagnostic(PAYLOAD_CODE, "必须是非空字符串", { path }));
    return undefined;
  }
  return value;
}

function readInteger(
  value: unknown,
  path: string,
  diagnostics: Diagnostic[],
  minimum: number,
): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    diagnostics.push(makeDiagnostic(PAYLOAD_CODE, "必须是整数", { path }));
    return undefined;
  }
  if (value < minimum) {
    diagnostics.push(makeDiagnostic(PAYLOAD_CODE, "必须不小于 " + String(minimum), { path }));
    return undefined;
  }
  return value;
}

/** 深拷负载里的值：数据文档不能持有调用方后续会改的引用。 */
function cloneValue<T>(value: T, path: string, diagnostics: Diagnostic[]): T | undefined {
  try {
    return structuredClone(value);
  } catch {
    diagnostics.push(makeDiagnostic(PAYLOAD_CODE, "必须是可深拷的 JSON 数据", { path }));
    return undefined;
  }
}

/**
 * 校验数据信封并归一化；失败返回 E-PAYLOAD 诊断，不抛。
 *
 * 只校验信封：`kind`、非空的 `owner` / `source`、非负整数 `revision`、
 * `value` / `items` / `changes` 恰好出现一个，且三者里的负载可深拷。
 * `items` / `changes` 的条目形状归集合原语（坏条目只丢自己并记诊断），这里不拦。
 */
export function parseData(value: unknown): ParseDataResult {
  if (!isRecord(value)) {
    return {
      ok: false,
      diagnostics: [makeDiagnostic(PAYLOAD_CODE, "payload 必须是对象", { path: "$" })],
    };
  }
  const diagnostics: Diagnostic[] = [];
  if (value.kind !== "data") {
    diagnostics.push(makeDiagnostic(PAYLOAD_CODE, "kind 必须是 data", { path: "$.kind" }));
  }
  const owner = readString(value.owner, "$.owner", diagnostics);
  const source = readString(value.source, "$.source", diagnostics);
  const revision = readInteger(value.revision, "$.revision", diagnostics, 0);
  const present = DATA_FIELDS.filter((field) => hasOwn(value, field));
  if (present.length !== 1) {
    diagnostics.push(
      makeDiagnostic(PAYLOAD_CODE, "value / items / changes 必须且只能出现一个", { path: "$" }),
    );
    return { ok: false, diagnostics };
  }
  const only = present[0];
  let payload: DataPayload | undefined;
  if (only === "items") {
    if (!Array.isArray(value.items)) {
      diagnostics.push(makeDiagnostic(PAYLOAD_CODE, "items 必须是数组", { path: "$.items" }));
    } else {
      const items = cloneValue(value.items, "$.items", diagnostics);
      if (items !== undefined) {
        payload = {
          kind: "data",
          owner: owner ?? "",
          source: source ?? "",
          revision: revision ?? 0,
          items: items as CollectionItem[],
        };
      }
    }
  } else if (only === "changes") {
    if (!Array.isArray(value.changes)) {
      diagnostics.push(makeDiagnostic(PAYLOAD_CODE, "changes 必须是数组", { path: "$.changes" }));
    } else {
      const changes = cloneValue(value.changes, "$.changes", diagnostics);
      if (changes !== undefined) {
        payload = {
          kind: "data",
          owner: owner ?? "",
          source: source ?? "",
          revision: revision ?? 0,
          changes: changes as CollectionChange[],
        };
      }
    }
  } else {
    const cloned = cloneValue(value.value, "$.value", diagnostics);
    if (cloned !== undefined) {
      payload = {
        kind: "data",
        owner: owner ?? "",
        source: source ?? "",
        revision: revision ?? 0,
        value: cloned,
      };
    }
  }
  if (
    payload === undefined ||
    diagnostics.length > 0 ||
    owner === undefined ||
    source === undefined ||
    revision === undefined
  ) {
    return { ok: false, diagnostics };
  }
  return { ok: true, payload };
}

/** 收集消费这条 source 的集合 slot id，按索引顺序去重（in 消费者不算）。 */
function collectionConsumers(index: DocumentIndex, source: string): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const id of index.slotsFor(source)) {
    const slot = index.get(id);
    if (slot?.collection === undefined || slot.collection.source !== source || seen.has(id)) {
      continue;
    }
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

/** 整槽实例化并把诊断记进批次；失败（理论上不会）时返回 undefined 不替换。 */
function instantiateSlot(
  slot: SlotNode,
  items: readonly unknown[],
  diagnostics: Diagnostic[],
): SlotNode | undefined {
  const result = instantiateCollection(slot, items);
  diagnostics.push(...result.diagnostics);
  return result.ok ? result.slot : undefined;
}

/** 更新后的数据源状态：最近一条负载决定它投影成 value 还是 items。 */
function nextSourceState(
  update: DataPayload,
  current: DataSourceState | undefined,
  nextItems: CollectionItem[] | undefined,
): DataSourceState {
  if ("items" in update) {
    return { revision: update.revision, items: update.items };
  }
  if ("changes" in update) {
    const items = nextItems ?? current?.items;
    return items === undefined
      ? { revision: update.revision }
      : { revision: update.revision, items };
  }
  return { revision: update.revision, value: update.value };
}

/**
 * 应用一条数据更新（纯函数、原子）。
 *
 * `payload` 接线上原始值（内部先走 `parseData`），所以非法信封在这里被拒绝。
 * 信封不合法 → `ok:false`，文档与数据都保持原样；条目级坏数据 → `ok:true` + 诊断。
 * 文档版本不变（数据更新不涨文档版本），只返回新的根树（未改动时返回同一引用）与
 * 新的数据文档；`changed` 是被重建的集合 slot id、或被标量绑定改了 props 的消费者 id，
 * 都按替换顺序去重。
 */
export function applyData(
  document: DocumentState,
  data: DataState,
  payload: unknown,
  options: ApplyDataOptions = {},
): ApplyDataResult {
  const parsed = parseData(payload);
  if (!parsed.ok) {
    return { ok: false, diagnostics: parsed.diagnostics };
  }
  const update = parsed.payload;
  const source = update.source;
  const current = hasOwn(data, source) ? data[source] : undefined;
  if (current !== undefined && update.revision <= current.revision) {
    return { ok: true, document, data, changed: [], diagnostics: [] };
  }
  const priorItems: CollectionItem[] = current?.items ?? [];
  const changed: string[] = [];
  const diagnostics: Diagnostic[] = [];
  let nextItems: CollectionItem[] | undefined = "items" in update ? update.items : undefined;
  let nextData: DataState;
  let root = document.root;
  if ("items" in update || "changes" in update) {
    let index = DocumentIndex.build(root);
    for (const id of collectionConsumers(index, source)) {
      // 只在当前树上定位消费者：它可能已被前一次整槽重建覆盖掉了。
      const slot = index.get(id);
      if (slot?.collection === undefined || slot.collection.source !== source) {
        continue;
      }
      const denied = options.guard?.(slot);
      if (denied !== undefined) {
        return { ok: false, diagnostics: [denied] };
      }
      let replacement: SlotNode | undefined;
      if ("items" in update) {
        replacement = instantiateSlot(slot, update.items, diagnostics);
      } else if ("changes" in update) {
        if (nextItems === undefined) {
          // 第一条增量：用第一个消费者的集合配置把 changes 落到条目列表上。
          const applied = applyCollectionChanges(slot, priorItems, update.changes);
          diagnostics.push(...applied.diagnostics);
          if (applied.ok) {
            nextItems = applied.items;
            replacement = applied.slot;
          }
        } else {
          replacement = instantiateSlot(slot, nextItems, diagnostics);
        }
      }
      if (replacement === undefined) {
        continue;
      }
      root = replaceSlotById(root, id, replacement);
      changed.push(id);
      // 替换后立刻从新根树重建索引，后面的消费者只在当前树上定位。
      index = DocumentIndex.build(root);
    }
    nextData = { ...data, [source]: nextSourceState(update, current, nextItems) };
  } else {
    // 标量：先写数据文档，再按 in/bind 把新值绑进消费者 props。
    nextData = { ...data, [source]: nextSourceState(update, current, undefined) };
    const bound = applyScalarBinding(root, nextData, source);
    const index = DocumentIndex.build(root);
    for (const id of bound.changed) {
      const consumer = index.get(id);
      if (consumer === undefined) {
        continue;
      }
      const denied = options.guard?.(consumer);
      if (denied !== undefined) {
        return { ok: false, diagnostics: [denied] };
      }
    }
    root = bound.root;
    changed.push(...bound.changed);
  }
  return {
    ok: true,
    document: root === document.root ? document : { root, version: document.version },
    data: nextData,
    changed,
    diagnostics,
  };
}

/**
 * 集合绑定：模板实例化与 keyed reconcile（S3-a）。
 *
 * 契约见 docs/engine/collection.md（§2–§7）与 docs/engine/addressing.md（列表项 id）：
 * 树里声明模板，数据只按 key 填字段；同 key 跨更新是同一个实例，局部状态不丢。
 *
 * 规则：
 * - 条目根实例 id = `<slotId>#<itemKey>`；子节点 id = `<父实例 id>/<模板节点 id>`，
 *   逐层派生。id 只由 slot id、数据 key 与模板内 id 决定，所以同 key 跨更新稳定、
 *   不同 key 全局不撞车。
 * - `bind` 的 key 是要写的 props 名，value 是相对当前条目的数据路径：
 *   `item.title`、`item.a.b`、裸 `title`（等价 `item.title`）。解析到值
 *   （`!== undefined`，null 也算值）就覆盖模板 props；解析不到保留模板原值。
 *   实例上不保留 `bind`——它已经解析成 props。
 * - 模板本身不进树。模板内嵌套 `collection` 不在本原语内实例化
 *   （collection.md §8「先不做」），实例上也不保留，否则同一模板 id 会在每个条目下重复。
 * - 坏条目只丢自己并记 `E-TEMPLATE`（key 重复记 `E-ID-DUPLICATE`），其余照常，
 *   结果仍是 ok:true；坏条目在下一次合法数据到达时恢复。
 * - slot 没有 `collection` 是调用方错误：`E-PAYLOAD`、ok:false、入参不变。
 *
 * `applyCollectionChanges` 维护条目列表的顺序与字段，最后仍走
 * `instantiateCollection` 整槽重建，所以「增量结果 == 用最终条目全量实例化」由构造保证。
 * 坏 change 一律记 `E-PAYLOAD` 并按最保守方式处理（不丢条目、不改无关条目）：
 * - 未知 kind、非对象 change、缺 key、key 不存在、insert 的 key 已存在 → 跳过该条 change；
 * - `at` 不是非负整数：insert 追加到末尾，move 保持原位；
 * - 越界的合法 `at` 夹到 `[0, len]`（insert 在插入前、move 在移除后算长度）；
 * - 身份字段始终以 `change.key` 为准；change 自带的身份字段与之不一致时记 `E-PAYLOAD`。
 */

import type { Collection, SlotNode } from "../contract/document";
import { makeDiagnostic } from "../link/parse";
import type { Diagnostic, DiagnosticCode } from "../contract/diagnostics";

const TEMPLATE_CODE: DiagnosticCode = "E-TEMPLATE";
const PAYLOAD_CODE: DiagnosticCode = "E-PAYLOAD";

/** 一条集合数据。身份字段名由 `slot.collection.key` 指定（通常是 `id`）。 */
export interface CollectionItem {
  id: string;
  template?: string;
  [field: string]: unknown;
}

/** 纯数据增量更新（docs/engine/collection.md §5）。 */
export type CollectionChange =
  | { kind: "insert"; key: string; item: CollectionItem; at?: number }
  | { kind: "update"; key: string; item: Partial<CollectionItem> }
  | { kind: "remove"; key: string }
  | { kind: "move"; key: string; at: number };

/** 实例化结果：ok:false 只在 slot 没有 collection 时出现，此时原 slot 不变。 */
export type CollectionResult =
  | { ok: true; slot: SlotNode; diagnostics: Diagnostic[] }
  | { ok: false; diagnostics: Diagnostic[] };

/** 增量结果：ok:false 时条目与 slot 都不变，调用方保留入参。 */
export type ApplyCollectionResult =
  | { ok: true; items: CollectionItem[]; slot: SlotNode; diagnostics: Diagnostic[] }
  | { ok: false; diagnostics: Diagnostic[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/** 把诊断里要引用的原始值渲染成可读文本（对象走 JSON，避免 [object Object]）。 */
function displayValue(value: unknown): string {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value) ?? "（无法序列化的值）";
}

function slotDiagnostic(
  code: DiagnosticCode,
  slot: SlotNode,
  message: string,
  path?: string,
): Diagnostic {
  const fields: { owner?: string; slot?: string; path?: string } = {
    owner: slot.owner,
    slot: slot.id,
  };
  if (path !== undefined) {
    fields.path = path;
  }
  return makeDiagnostic(code, "slot " + slot.id + "：" + message, fields);
}

/** 从一条原始数据里读身份字段；缺失 / 非字符串 / 空串都算没有 key。 */
function readItemKey(item: Record<string, unknown>, field: string): string | undefined {
  const value = item[field];
  return isText(value) ? value : undefined;
}

/**
 * 相对当前条目解析 bind 路径：`item.a.b` / `a.b` / 裸 `title`。
 * `item` 前缀可省；返回值是 `undefined` 表示解析不到（不是值为 undefined）。
 */
export function resolveBindPath(item: Record<string, unknown>, path: string): unknown {
  const segments = path.split(".");
  if (segments[0] === "item") {
    segments.shift();
  }
  if (segments.length === 0) {
    return undefined;
  }
  let current: unknown = item;
  for (const segment of segments) {
    if (segment === "" || !isRecord(current)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

/** 用模板实例化一个节点：派生 id、把 bind 解析进 props、递归克隆子节点。 */
function instantiateNode(
  template: SlotNode,
  instanceId: string,
  item: Record<string, unknown>,
): SlotNode {
  const props: Record<string, unknown> = { ...template.props };
  if (template.bind !== undefined) {
    for (const [name, path] of Object.entries(template.bind)) {
      const value = resolveBindPath(item, path);
      if (value !== undefined) {
        props[name] = value;
      }
    }
  }
  const instance: SlotNode = {
    ...template,
    id: instanceId,
    props,
    children: template.children.map((child) =>
      instantiateNode(child, instanceId + "/" + child.id, item),
    ),
  };
  delete instance.bind;
  delete instance.collection;
  return instance;
}

/**
 * 按数据实例化一个集合 slot：`slot.children` 变成条目实例（按 items 顺序），
 * 模板本身不进树。坏条目跳过并记诊断，其余照常（结果仍是 ok:true）。
 */
export function instantiateCollection(slot: SlotNode, items: readonly unknown[]): CollectionResult {
  const collection = slot.collection;
  if (collection === undefined) {
    return {
      ok: false,
      diagnostics: [slotDiagnostic(PAYLOAD_CODE, slot, "没有 collection，不能按数据实例化条目")],
    };
  }
  const diagnostics: Diagnostic[] = [];
  const children: SlotNode[] = [];
  const seen = new Set<string>();
  items.forEach((raw, index) => {
    const path = "items[" + String(index) + "]";
    if (!isRecord(raw)) {
      diagnostics.push(
        slotDiagnostic(
          TEMPLATE_CODE,
          slot,
          "第 " + String(index) + " 条数据不是对象，已跳过",
          path,
        ),
      );
      return;
    }
    const key = readItemKey(raw, collection.key);
    if (key === undefined) {
      diagnostics.push(
        slotDiagnostic(
          TEMPLATE_CODE,
          slot,
          "第 " + String(index) + " 条数据缺少 key「" + collection.key + "」，已跳过",
          path,
        ),
      );
      return;
    }
    const templateName = raw[collection.select];
    if (!isText(templateName)) {
      diagnostics.push(
        slotDiagnostic(
          TEMPLATE_CODE,
          slot,
          "条目「" + key + "」缺少模板选择字段「" + collection.select + "」，已跳过",
          path,
        ),
      );
      return;
    }
    const template = collection.templates[templateName];
    if (template === undefined) {
      diagnostics.push(
        slotDiagnostic(
          TEMPLATE_CODE,
          slot,
          "条目「" + key + "」选了不存在的模板「" + templateName + "」，已跳过",
          path,
        ),
      );
      return;
    }
    if (seen.has(key)) {
      diagnostics.push(
        slotDiagnostic("E-ID-DUPLICATE", slot, "条目 key「" + key + "」重复，只保留第一条", path),
      );
      return;
    }
    seen.add(key);
    children.push(instantiateNode(template, slot.id + "#" + key, raw));
  });
  return { ok: true, slot: { ...slot, children }, diagnostics };
}

function findItemIndex(working: readonly unknown[], collection: Collection, key: string): number {
  return working.findIndex((item) => isRecord(item) && item[collection.key] === key);
}

/** 维护条目列表的一条 change；坏 change 记诊断并按最保守方式跳过 / 兜底。 */
function applyChange(
  working: unknown[],
  raw: unknown,
  index: number,
  collection: Collection,
  slot: SlotNode,
  diagnostics: Diagnostic[],
): void {
  const path = "changes[" + String(index) + "]";
  const fail = (message: string): void => {
    diagnostics.push(slotDiagnostic(PAYLOAD_CODE, slot, message, path));
  };
  if (!isRecord(raw)) {
    fail("第 " + String(index) + " 条 change 不是对象，已跳过");
    return;
  }
  const rawKey = raw.key;
  const key = isText(rawKey) ? rawKey : undefined;
  if (key === undefined) {
    fail("第 " + String(index) + " 条 change 缺少非空字符串 key，已跳过");
    return;
  }
  switch (raw.kind) {
    case "insert": {
      if (findItemIndex(working, collection, key) !== -1) {
        fail("insert 的 key「" + key + "」已存在，已跳过");
        return;
      }
      const rawItem = raw.item;
      if (!isRecord(rawItem)) {
        fail("insert「" + key + "」的 item 必须是对象，已跳过");
        return;
      }
      const carried = rawItem[collection.key];
      if (carried !== undefined && carried !== key) {
        fail(
          "insert 条目自带 key「" +
            displayValue(carried) +
            "」与 change.key「" +
            key +
            "」不一致，以 change.key 为准",
        );
      }
      let at = working.length;
      const rawAt = raw.at;
      if (rawAt !== undefined) {
        if (typeof rawAt === "number" && Number.isInteger(rawAt) && rawAt >= 0) {
          at = Math.min(rawAt, working.length);
        } else {
          fail("insert「" + key + "」的 at 必须是非负整数，已追加到末尾");
        }
      }
      working.splice(at, 0, { ...rawItem, [collection.key]: key });
      return;
    }
    case "update": {
      const at = findItemIndex(working, collection, key);
      if (at === -1) {
        fail("update 的 key「" + key + "」不存在，已跳过");
        return;
      }
      const patch = raw.item;
      if (!isRecord(patch)) {
        fail("update「" + key + "」的 item 必须是对象，已跳过");
        return;
      }
      const carried = patch[collection.key];
      if (carried !== undefined && carried !== key) {
        fail("update「" + key + "」的 item 自带 key 与 change.key 不一致，以 change.key 为准");
      }
      const current = working[at];
      const merged: Record<string, unknown> = isRecord(current) ? { ...current } : {};
      for (const [name, value] of Object.entries(patch)) {
        merged[name] = value;
      }
      merged[collection.key] = key;
      working[at] = merged;
      return;
    }
    case "remove": {
      const at = findItemIndex(working, collection, key);
      if (at === -1) {
        fail("remove 的 key「" + key + "」不存在，已跳过");
        return;
      }
      working.splice(at, 1);
      return;
    }
    case "move": {
      const from = findItemIndex(working, collection, key);
      if (from === -1) {
        fail("move 的 key「" + key + "」不存在，已跳过");
        return;
      }
      const rawAt = raw.at;
      if (typeof rawAt !== "number" || !Number.isInteger(rawAt) || rawAt < 0) {
        fail("move「" + key + "」的 at 必须是非负整数，已保持原位");
        return;
      }
      const at = rawAt;
      const moved = working[from];
      if (moved === undefined) {
        fail("move「" + key + "」定位失败，已保持原位");
        return;
      }
      working.splice(from, 1);
      working.splice(Math.min(at, working.length), 0, moved);
      return;
    }
    default: {
      fail(
        "第 " + String(index) + " 条 change 的 kind「" + displayValue(raw.kind) + "」未知，已跳过",
      );
    }
  }
}

/**
 * 应用一批纯数据增量，再用 `instantiateCollection` 整槽重建。
 * 条目列表与 slot 都不改入参；失败（slot 没有 collection）时两者都保持原样。
 */
export function applyCollectionChanges(
  slot: SlotNode,
  items: readonly unknown[],
  changes: readonly unknown[],
): ApplyCollectionResult {
  if (slot.collection === undefined) {
    return {
      ok: false,
      diagnostics: [slotDiagnostic(PAYLOAD_CODE, slot, "没有 collection，不能应用条目增量")],
    };
  }
  const collection = slot.collection;
  const diagnostics: Diagnostic[] = [];
  const working: unknown[] = [...items];
  changes.forEach((raw, index) => {
    applyChange(working, raw, index, collection, slot, diagnostics);
  });
  const instantiated = instantiateCollection(slot, working);
  if (!instantiated.ok) {
    return { ok: false, diagnostics: [...diagnostics, ...instantiated.diagnostics] };
  }
  return {
    ok: true,
    items: working as CollectionItem[],
    slot: instantiated.slot,
    diagnostics: [...diagnostics, ...instantiated.diagnostics],
  };
}

/**
 * 标量数据绑定（S3-c）：把 `data[source].value` 按 `in` / `bind` 解析进消费者 props。
 *
 * 语义按 S3-c 任务固定（rules.md §4「数据到达时先按绑定更新值」、contract.md「bind 把
 * prop 映射到作用域内数据路径」）：
 * - 只处理标量负载（带 `value` 的 data）；集合条目由 collection 原语负责，不在这里。
 * - 消费者 = 根树里 `in` 含该 `source` 的可寻址节点（索引包含 `collection.templates`
 *   子树，所以模板节点声明了 `in` 也算；集合 slot 自己声明 `in` 时同样算）。
 * - 对每个消费者的每个 bind 条目 `prop → pointer`：
 *   1. 选 input：pointer 等于 `source`、或以 `source + "."` 开头时，用消费该 source 的
 *      input，剩余部分为 relative（pointer 恰好等于 source 时 relative 为空 → 解析不到）；
 *      否则 `slot.in.length === 1` 时用唯一 input，`relative = pointer`；多 input 又没写
 *      source 前缀时无法消歧，跳过这条 bind（不改 props、不报错）。
 *   2. 解析：relative 按 `"."` 分段，从本批次刚写入的 `data[source].value` 上取值；
 *      空段、缺段、中途不是普通对象（数组按非对象处理）都算解析不到。
 *      `in[].path` 只是订阅粒度提示，**不作为解析前缀**：解析永远从 value 根开始。
 *   3. 解析到值（`!== undefined`，null 也算值）→ 写进 `props[prop]`；解析不到 → 保留原值。
 * - 有 props 变化才按 id 原位替换节点（结构共享：没碰到的分支保留原引用）并计入 changed；
 *   解析到结构相同的值（深比较）不算变化。没有变化的节点不替换、引用不变，渲染层可按引用
 *   跳过。
 * - 多消费者按索引顺序（文档序）更新；每次替换后从新根树重建索引，所以祖先与后代同时
 *   命中时也不会用旧节点覆盖新值。
 * - 纯函数：入参不改；返回新的根树（无变化时返回同一引用）。
 *
 * 本文件同时放 `replaceSlotById`：data router 的集合路径与标量绑定都要按 id 原位替换
 * 子树（含 `collection.templates`），放在这里避免两个模块互相 import 成环。
 */

import type { Input, SlotNode } from "../../contract/document";
import type { DataState } from "./data";
import { DocumentIndex } from "../document/document";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

/**
 * 按 id 原位替换一棵子树（纯递归，结构共享：没碰到的分支返回原引用）。
 * 集合 slot 也可能在别的 slot 的 `collection.templates` 里，因此 templates 也要查。
 */
export function replaceSlotById(node: SlotNode, targetId: string, replacement: SlotNode): SlotNode {
  if (node.id === targetId) {
    return replacement;
  }
  const children = node.children.map((child) => replaceSlotById(child, targetId, replacement));
  const childChanged = children.some((child, index) => child !== node.children[index]);
  let collection = node.collection;
  if (collection !== undefined) {
    let templatesChanged = false;
    const templates: Record<string, SlotNode> = {};
    for (const [name, template] of Object.entries(collection.templates)) {
      const next = replaceSlotById(template, targetId, replacement);
      templates[name] = next;
      if (next !== template) {
        templatesChanged = true;
      }
    }
    if (templatesChanged) {
      collection = { ...collection, templates };
    }
  }
  if (!childChanged && collection === node.collection) {
    return node;
  }
  return collection === node.collection ? { ...node, children } : { ...node, children, collection };
}

/** 深比较 props 值：解析到结构相同的值也算「没变」，不替换节点。 */
function sameValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length && left.every((item, index) => sameValue(item, right[index]))
    );
  }
  if (isRecord(left) && isRecord(right)) {
    const keys = Object.keys(left);
    return (
      keys.length === Object.keys(right).length &&
      keys.every((key) => hasOwn(right, key) && sameValue(left[key], right[key]))
    );
  }
  return false;
}

/** 选 input 并算出相对路径；undefined 表示这条 bind 无法消歧、跳过。 */
function selectRelative(
  inputs: readonly Input[],
  source: string,
  pointer: string,
): string | undefined {
  if (pointer === source) {
    return "";
  }
  const prefix = source + ".";
  if (pointer.startsWith(prefix)) {
    return pointer.slice(prefix.length);
  }
  return inputs.length === 1 ? pointer : undefined;
}

/**
 * 从 `data[source].value` 按相对路径取值。
 * undefined 表示解析不到：空段、缺段、中途不是普通对象、source 还没有 value。
 */
function resolveRelative(data: DataState, source: string, relative: string): unknown {
  let current: unknown = hasOwn(data, source) ? data[source]?.value : undefined;
  for (const segment of relative.split(".")) {
    if (segment === "" || !isRecord(current) || !hasOwn(current, segment)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

/** 解析一个消费者的全部 bind；没有任何 props 变化时返回 undefined。 */
function bindProps(
  slot: SlotNode,
  data: DataState,
  source: string,
): Record<string, unknown> | undefined {
  const bind = slot.bind;
  if (bind === undefined) {
    return undefined;
  }
  const inputs = slot.in ?? [];
  let props: Record<string, unknown> | undefined;
  for (const [prop, pointer] of Object.entries(bind)) {
    const relative = selectRelative(inputs, source, pointer);
    if (relative === undefined) {
      continue;
    }
    const value = resolveRelative(data, source, relative);
    if (value === undefined) {
      continue;
    }
    const current = props ?? slot.props;
    if (hasOwn(current, prop) && sameValue(current[prop], value)) {
      continue;
    }
    props = { ...current, [prop]: value };
  }
  return props;
}

/** 消费者 id：`in` 里含该 source 的可寻址节点，按索引顺序去重。 */
function scalarConsumers(index: DocumentIndex, source: string): string[] {
  const ids = index.slotsFor(source).filter((id) => {
    const slot = index.get(id);
    return slot?.in?.some((input) => input.source === source) === true;
  });
  return [...new Set(ids)];
}

/** 标量绑定结果：新根树 + 被改 props 的消费者 id（文档序）。 */
export interface ScalarBindResult {
  root: SlotNode;
  changed: string[];
}

/**
 * 应用一次标量绑定：按 `in` 找消费者、按 `bind` 解析值写进 props。
 * 无 props 变化时返回同一根树引用与空 changed。
 */
export function applyScalarBinding(
  root: SlotNode,
  data: DataState,
  source: string,
): ScalarBindResult {
  const changed: string[] = [];
  let current = root;
  let index = DocumentIndex.build(current);
  for (const id of scalarConsumers(index, source)) {
    const slot = index.get(id);
    if (slot === undefined) {
      continue;
    }
    const props = bindProps(slot, data, source);
    if (props === undefined) {
      continue;
    }
    current = replaceSlotById(current, id, { ...slot, props });
    changed.push(id);
    index = DocumentIndex.build(current);
  }
  return { root: current, changed };
}

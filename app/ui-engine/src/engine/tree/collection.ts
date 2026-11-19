/**
 * V1 集合实例化：把 collection 节点按 data[source].items 展开成实例子节点。
 *
 * 只做挂载期展开：实例 id = `<collectionId>#<key>`，子节点 id = `<父实例 id>/<模板节点 id>`；
 * 同 key 跨 replace 稳定，所以 buildNode 的按 id 复用就是 keyed reconcile。
 * bind 用相对路径（item.title / title）解析进 settings；实例不保留 collection。
 * 坏条目只丢自己并记 E-TEMPLATE，其余照常。
 */

import type { Collection, Node as TreeNode } from "../../contract/tree_generated";
import type { TreeRuntimeDiagnostic } from "./types";

export interface CollectionExpansion {
  readonly nodes: TreeNode[];
  readonly diagnostics: TreeRuntimeDiagnostic[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/** 相对当前条目解析 bind 路径：`item.a.b` / `a.b` / 裸 `title`。 */
export function resolveItemPath(item: Record<string, unknown>, path: string): unknown {
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

function instantiate(
  template: TreeNode,
  id: string,
  chain: string,
  item: Record<string, unknown>,
): TreeNode {
  const settings: Record<string, unknown> = { ...template.settings };
  for (const [name, path] of Object.entries(template.bind)) {
    if (typeof path !== "string") {
      continue;
    }
    const value = resolveItemPath(item, path);
    if (value !== undefined) {
      settings[name] = value;
    }
  }
  const node: TreeNode = { ...template, id, chain, settings, bind: {}, layout: [] };
  delete node.collection;
  node.layout = template.layout.map((child) =>
    instantiate(child, id + "/" + child.id, chain + "." + child.id, item),
  );
  return node;
}

/** 按 collection + data 展开实例；没有 data 时返回空列表（数据先到后到都允许）。 */
export function expandCollection(
  slot: TreeNode,
  collection: Collection,
  data: Record<string, unknown>,
): CollectionExpansion {
  const diagnostics: TreeRuntimeDiagnostic[] = [];
  const entry = data[collection.source];
  let items: unknown[] = [];
  if (entry !== undefined) {
    if (isRecord(entry) && Array.isArray(entry.items)) {
      items = entry.items;
    } else {
      diagnostics.push({
        code: "E-TEMPLATE",
        path: "/data/" + collection.source,
        message: "data source 不是 items 形态，collection 没有条目",
      });
    }
  }
  const nodes: TreeNode[] = [];
  const seen = new Set<string>();
  const select = collection.select ?? "template";
  items.forEach((raw, index) => {
    const path = "/data/" + collection.source + "/items/" + String(index);
    if (!isRecord(raw)) {
      diagnostics.push({ code: "E-TEMPLATE", path, message: "条目不是对象，已跳过" });
      return;
    }
    const key = raw[collection.key];
    if (!isText(key)) {
      diagnostics.push({
        code: "E-TEMPLATE",
        path,
        message: "条目缺少 key「" + collection.key + "」，已跳过",
      });
      return;
    }
    const templateName = raw[select];
    if (!isText(templateName)) {
      diagnostics.push({
        code: "E-TEMPLATE",
        path,
        message: "条目「" + key + "」缺少模板字段「" + select + "」，已跳过",
      });
      return;
    }
    const template = collection.templates[templateName];
    if (template === undefined) {
      diagnostics.push({
        code: "E-TEMPLATE",
        path,
        message: "条目「" + key + "」选了不存在的模板「" + templateName + "」，已跳过",
      });
      return;
    }
    if (seen.has(key)) {
      diagnostics.push({
        code: "E-ID-DUPLICATE",
        path,
        message: "条目 key「" + key + "」重复，只保留第一条",
      });
      return;
    }
    seen.add(key);
    nodes.push(instantiate(template, slot.id + "#" + key, slot.chain + "." + key, raw));
  });
  return { nodes, diagnostics };
}

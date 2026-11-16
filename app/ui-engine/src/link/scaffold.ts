/**
 * 窗口根骨架加载器（S7.2）：`app/sdk/omora/sdk/root-tree.json` 是窗口骨架的唯一来源。
 *
 * 根树结构文件定义窗口根、导航栏与页面区三个 Slot 的 id / kind / 布局，以及
 * `anchors` 语义锚点（window / nav / page → Slot id）。链接期编译器拿它当 `base`；
 * 挂载目标由局部树按 `mountAt` 填。骨架是只读常量：链接器先深拷再改，改不到这里。
 *
 * 加载即校验：用契约层的 `parseDocument` 把根节点包成最小文档校验 Slot 形状
 * （id 唯一、kind 命名空间、owner、布局、可选 code/addr），再校验锚点存在且指向
 * 树里真实的 id、根 kind 是 `dendro:window`；文件坏了在模块加载期就抛。
 */

import rootTreeJson from "../../../sdk/omora/sdk/root-tree.json";
import { DocumentError, parseDocument } from "../contract/document";
import type { SlotNode } from "../contract/document";

/** 语义锚点：语义名 → 根树里的 Slot id。 */
export interface WindowAnchors {
  readonly window: string;
  readonly nav: string;
  readonly page: string;
}

/** 校验过的窗口骨架：规范化根节点 + 锚点。 */
export interface WindowScaffold {
  readonly root: SlotNode;
  readonly anchors: WindowAnchors;
}

const ROOT_KIND = "dendro:window";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(message: string): never {
  throw new DocumentError("bad_root_tree", "$", message);
}

function collectIds(node: SlotNode, found: Set<string>): void {
  found.add(node.id);
  for (const child of node.children) {
    collectIds(child, found);
  }
  const templates = node.collection?.templates;
  if (templates !== undefined) {
    for (const template of Object.values(templates)) {
      collectIds(template, found);
    }
  }
}

function requiredAnchor(anchors: Record<string, string>, name: string): string {
  const target = anchors[name];
  if (target === undefined) {
    fail("anchors 缺少锚点: " + name);
  }
  return target;
}

function parseAnchors(value: unknown, ids: ReadonlySet<string>, rootId: string): WindowAnchors {
  if (!isRecord(value)) {
    fail("anchors 必须是对象");
  }
  const anchors: Record<string, string> = {};
  for (const [name, target] of Object.entries(value)) {
    if (name.trim() === "") {
      fail("anchors 的键必须是非空字符串");
    }
    if (typeof target !== "string" || target.trim() === "") {
      fail("anchors." + name + " 必须是非空字符串");
    }
    if (!ids.has(target)) {
      fail("anchors." + name + " 指向不存在的 id: " + target);
    }
    anchors[name] = target;
  }
  const window = requiredAnchor(anchors, "window");
  const nav = requiredAnchor(anchors, "nav");
  const page = requiredAnchor(anchors, "page");
  if (window !== rootId) {
    fail("anchors.window 必须是根 id: " + rootId);
  }
  return { window, nav, page };
}

/** 校验一份根树结构（已解析的 JSON 值）；形状不对直接抛 DocumentError。 */
export function parseWindowScaffold(value: unknown): WindowScaffold {
  if (!isRecord(value)) {
    fail("根树结构必须是对象");
  }
  const document = parseDocument({
    schema: value.schema,
    version: value.version,
    pages: [],
    active: "",
    data: {},
    document: value.root,
  });
  const root = document.document;
  if (root.kind !== ROOT_KIND) {
    fail("root.kind 必须是 " + ROOT_KIND + "，实际是 " + root.kind);
  }
  const ids = new Set<string>();
  collectIds(root, ids);
  return { root, anchors: parseAnchors(value.anchors, ids, root.id) };
}

function deepFreeze<T>(value: T): T {
  if (Array.isArray(value)) {
    for (const item of value) {
      deepFreeze(item);
    }
    return Object.freeze(value) as T;
  }
  if (typeof value === "object" && value !== null) {
    for (const item of Object.values(value)) {
      deepFreeze(item);
    }
    return Object.freeze(value);
  }
  return value;
}

const PARSED = parseWindowScaffold(rootTreeJson);

/** 三栏母壳的根：图标栏（56px）+ 主区；两栏都由页面来源填。 */
export const WINDOW_SCAFFOLD: SlotNode = deepFreeze(PARSED.root);

/** 语义锚点 → 根树 Slot id；挂载目标从这里取，不写死字面量。 */
export const WINDOW_ANCHORS: WindowAnchors = Object.freeze({ ...PARSED.anchors });

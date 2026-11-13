/**
 * dom/slot 测试的共享支持：读共享 `document.json`、手动物化集合、按 id 找/换子树。
 * 只在测试里 import，不属于渲染引擎的生产模块图。
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDocument, type SlotDocument, type SlotNode } from "../../contract/document";
import type { JsonObject } from "../../core/protocol";
import type { Node } from "../../core/types";
import { instantiateCollection } from "../../runtime/collection";
import { DomRenderer } from "../renderer";
import type { RenderContext } from "../types";
import { slotRegistry } from "./registry";

/**
 * 共享 fixture 的绝对路径。用 node:path 而不是 `new URL(..., import.meta.url)`：
 * jsdom 环境下 Vite 会把后者当资源 URL 改写成 dev server 地址，fileURLToPath 会拒收。
 */
const HERE = dirname(fileURLToPath(import.meta.url));
export const DOCUMENT_FIXTURE_PATH = resolve(HERE, "../../../../sdk/tests/fixtures/document.json");

export interface RecordedSlotEvent {
  handler: string;
  payload?: JsonObject;
}

export interface MountedSlot {
  container: HTMLElement;
  renderer: DomRenderer;
  events: RecordedSlotEvent[];
  render(node: Node): void;
  destroy(): void;
}

/** jsdom 里用 Slot 注册表挂一棵已桥接的树，记录发出去的事件。 */
export function mountNode(root: Node): MountedSlot {
  const events: RecordedSlotEvent[] = [];
  const context: RenderContext = {
    event: (handler, payload) => events.push({ handler, payload }),
    loadMedia: () => Promise.resolve({ mime: "", data: "" }),
    cleanup: () => undefined,
  };
  const container = document.createElement("div");
  document.body.append(container);
  const renderer = new DomRenderer({ registry: slotRegistry, context });
  renderer.render(root, container);
  return {
    container,
    renderer,
    events,
    render: (node) => renderer.render(node, container),
    destroy: () => {
      renderer.dispose();
      container.remove();
    },
  };
}

export function readDocumentFixture(): unknown {
  const raw = readFileSync(DOCUMENT_FIXTURE_PATH, "utf8");
  return JSON.parse(raw) as unknown;
}

/** 共享 fixture 校验后的文档；失败直接抛（fixture 是契约）。 */
export function fixtureDocument(): SlotDocument {
  return parseDocument(readDocumentFixture());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function findById(root: SlotNode, id: string): SlotNode | undefined {
  if (root.id === id) {
    return root;
  }
  for (const child of root.children) {
    const found = findById(child, id);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

/** 按 id 原位替换一棵子树；未触碰的分支保持引用（结构共享）。 */
export function replaceById(root: SlotNode, id: string, next: SlotNode): SlotNode {
  if (root.id === id) {
    return next;
  }
  let changed = false;
  const children = root.children.map((child) => {
    const replaced = replaceById(child, id, next);
    if (replaced !== child) {
      changed = true;
    }
    return replaced;
  });
  return changed ? { ...root, children } : root;
}

/**
 * 共享 fixture + 手动物化 `ideas.feed`：真实路径是运行时（collection.ts /
 * hydrate）先实例化再渲染，这里只把渲染接入要用的终态树造出来。
 */
export function fixtureWithInstantiatedFeed(): SlotNode {
  const document = fixtureDocument();
  const feed = findById(document.document, "ideas.feed");
  if (feed === undefined) {
    throw new Error("共享 fixture 应有 ideas.feed");
  }
  const source = document.data["ideas.feed"];
  if (!isRecord(source) || !Array.isArray(source.items)) {
    throw new Error("共享 fixture 的 ideas.feed 应有 items 数组");
  }
  const instantiated = instantiateCollection(feed, source.items);
  if (!instantiated.ok) {
    throw new Error("共享 fixture 的 feed 应能实例化: " + JSON.stringify(instantiated.diagnostics));
  }
  return replaceById(document.document, "ideas.feed", instantiated.slot);
}

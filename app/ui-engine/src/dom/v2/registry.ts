/**
 * v2 渲染注册表（S3-d）：v1 词表的命名空间别名 + 宿主别名 + v2 原生 kind。
 *
 * - `dendro:<v1 type>`：把现有 v1 kind 直接挂到 v2 命名空间下（`dendro:text` →
 *   v1 `text`），不复制实现、不改 v1 registry；
 * - `ideas:card` → v1 `card`：宿主插件词表的别名；
 * - v2 原生 kind（window / page / slot / layer / page-link）来自 kinds.ts。
 *
 * 合并顺序：v2 原生 kind 放最后，所以 `dendro:slot` 走 layout 版的容器，
 * 而不是 v1 的无 layout `slot`——同名时 v2 语义优先。
 */

import type { SlotNode } from "../../core/document";
import { DomRenderer } from "../renderer";
import { registry as v1Registry } from "../registry";
import type { Kind, KindRegistry, RenderContext } from "../types";
import { slotToNode } from "./bridge";
import { v2Kinds } from "./kinds";

function namespacedV1Kinds(): Record<string, Kind> {
  const aliases: Record<string, Kind> = {};
  for (const [type, kind] of Object.entries(v1Registry)) {
    aliases["dendro:" + type] = kind;
  }
  return aliases;
}

function hostAliases(): Record<string, Kind> {
  const card = v1Registry["card"];
  return card === undefined ? {} : { "ideas:card": card };
}

/** v2 kind → Kind；别名与 v2 原生 kind 合成一张表。 */
export const v2Registry: KindRegistry = {
  ...namespacedV1Kinds(),
  ...hostAliases(),
  ...v2Kinds,
};

/** 用 v2 注册表建 DomRenderer；SlotNode 先用 bridge.ts 的 slotToNode 桥接再 render。 */
export function createSlotRenderer(context: RenderContext): DomRenderer {
  return new DomRenderer({ registry: v2Registry, context });
}

/**
 * 便利入口：把一棵 v2 根树直接挂到容器上，返回 renderer 供后续
 * `render(slotToNode(nextRoot), container)` / `dispose()`。
 */
export function mountSlot(
  root: SlotNode,
  container: HTMLElement,
  context: RenderContext,
): DomRenderer {
  const renderer = createSlotRenderer(context);
  renderer.render(slotToNode(root), container);
  return renderer;
}

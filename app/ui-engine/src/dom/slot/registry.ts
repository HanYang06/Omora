/**
 * Slot 渲染注册表（S3-d）：legacy 词表的命名空间别名 + 宿主别名 + Slot 原生 kind。
 *
 * - `dendro:<legacy type>`：把现有 legacy kind 直接挂到 Slot 命名空间下
 *   （`dendro:text` → legacy `text`），不复制实现、不改 legacy registry；
 * - `ideas:card` → legacy `card`：宿主插件词表的别名；
 * - Slot 原生 kind（window / page / slot / layer / page-link）来自 kinds.ts。
 *
 * 合并顺序：Slot 原生 kind 放最后，所以 `dendro:slot` 走 layout 版的容器，
 * 而不是 legacy 的无 layout `slot`——同名时 Slot 语义优先。
 */

import type { SlotNode } from "../../core/document";
import { DomRenderer } from "../renderer";
import { registry as legacyRegistry } from "../registry";
import type { Kind, KindRegistry, RenderContext } from "../types";
import { slotToNode } from "./bridge";
import { slotKinds } from "./kinds";

function namespacedLegacyKinds(): Record<string, Kind> {
  const aliases: Record<string, Kind> = {};
  for (const [type, kind] of Object.entries(legacyRegistry)) {
    aliases["dendro:" + type] = kind;
  }
  return aliases;
}

function hostAliases(): Record<string, Kind> {
  const card = legacyRegistry["card"];
  return card === undefined ? {} : { "ideas:card": card };
}

/** Slot kind → Kind；别名与 Slot 原生 kind 合成一张表。 */
export const slotRegistry: KindRegistry = {
  ...namespacedLegacyKinds(),
  ...hostAliases(),
  ...slotKinds,
};

/** 用 Slot 注册表建 DomRenderer；SlotNode 先用 bridge.ts 的 slotToNode 桥接再 render。 */
export function createSlotRenderer(context: RenderContext): DomRenderer {
  return new DomRenderer({ registry: slotRegistry, context });
}

/**
 * 便利入口：把一棵 Slot 根树直接挂到容器上，返回 renderer 供后续
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

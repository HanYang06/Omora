/**
 * V1 树的 kind 词表：`dendro.tree/1` 的 kind → 现有组件实现。
 *
 * V1 的 kind 是裸名字（column / text / card…），和 legacy 注册表同键；结构根 `app`
 * 与导航入口 `page-link` 不在 legacy 表里，在这里补：
 * - `app`：窗口根，横向容器（V1 文档的 root kind 固定是 app）；
 * - `page-link`：复用 Slot 的导航入口实现。
 *
 * 这张表是「kind 存在性」的唯一来源：构建期用它挡未知 kind，运行时用它找实现。
 * 模块只在函数里碰 DOM，导入它不要求 window。
 */

import type { Kind, KindRegistry } from "../renderer/types";
import { registry } from "./registry";
import { slotKinds } from "./slot_kinds";
import { virtualListKinds } from "./virtual_list";

const app: Kind = {
  create() {
    const el = document.createElement("div");
    el.className = "omora-row";
    el.dataset.type = "app";
    el.dataset.dendroLayout = "slot";
    return el;
  },
};

function requireKind(kind: Kind | undefined, name: string): Kind {
  if (kind === undefined) {
    throw new Error("缺少组件实现: " + name);
  }
  return kind;
}

/** 树 V1 的 kind → Kind；裸名字与 legacy 注册表同键。 */
export const treeKinds: KindRegistry = {
  ...registry,
  ...virtualListKinds,
  app,
  "page-link": requireKind(slotKinds["dendro:page-link"], "dendro:page-link"),
};

/** 已知 kind 名单（排序稳定）。构建期门禁用它挡未知 kind。 */
export function treeKindNames(): readonly string[] {
  return Object.keys(treeKinds).sort();
}

/** 已知 kind 集合（与名单同一份）；构建期只读。 */
export function knownTreeKinds(): ReadonlySet<string> {
  return new Set(treeKindNames());
}

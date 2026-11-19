/**
 * `?engine=dialog` 预览：原生 <dialog> 模态打开，Esc 关闭。
 */

import type { Document as TreeDocument, Node as TreeNode } from "../contract/tree_generated";
import { mountTreeDocument } from "./tree/tree_renderer";

const ROOT = "a1b2c3d4e5f6a7b8";
const PAGE = "b1c2d3e4f5a6b7c8";
const DIALOG = "c1d2e3f4a5b6c7d8";
const BODY = "d1e2f3a4b5c6d7e8";

function node(
  id: string,
  chain: string,
  kind: string,
  order: number,
  over: Partial<TreeNode> = {},
): TreeNode {
  return {
    id,
    chain,
    kind,
    order,
    layout: [],
    settings: {},
    bind: {},
    on: {},
    emit: {},
    ...over,
  };
}

export function dialogPreviewDocument(): TreeDocument {
  const body = node(BODY, ROOT + "." + PAGE + "." + DIALOG + "." + BODY, "text", 10, {
    settings: { text: "这是对话框里的内容。" },
  });
  const dialog = node(DIALOG, ROOT + "." + PAGE + "." + DIALOG, "dialog", 10, {
    settings: { open: true, label: "示例对话框" },
    layout: [body],
  });
  const page = node(PAGE, ROOT + "." + PAGE, "column", 10, {
    layout: [
      node("e1f2a3b4c5d6e7f8", ROOT + "." + PAGE + ".e1f2a3b4c5d6e7f8", "text", 10, {
        settings: { text: "背景内容，对话框打开时应不可交互。" },
      }),
      dialog,
    ],
    slot: { size: { width: "fill" } },
  });
  return {
    schema: "dendro.tree/1",
    version: 1,
    root: node(ROOT, ROOT, "app", 0, { layout: [page] }),
    pages: [{ id: PAGE, title: "对话框", route: "/dialog" }],
    active: PAGE,
    data: {},
  };
}

export function mountDialogPreview(container: HTMLElement): void {
  container.replaceChildren();
  mountTreeDocument(container, dialogPreviewDocument(), {
    event: () => undefined,
    loadMedia: () => Promise.reject(new Error("对话框预览不加载媒体")),
    cleanup: () => undefined,
  });
}

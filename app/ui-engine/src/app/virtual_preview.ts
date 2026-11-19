/**
 * `?engine=virtual` 预览：1000 行的虚拟列表，用来看窗口化行为。
 *
 * 不连 Python；数据直接写在文档 settings 里，collection 投影下一步接。
 */

import type { Document as TreeDocument, Node as TreeNode } from "../contract/tree_generated";
import { mountTreeDocument } from "./tree/tree_renderer";

const ROOT = "a1b2c3d4e5f6a7b8";
const PAGE = "b1c2d3e4f5a6b7c8";
const LIST = "c1d2e3f4a5b6c7d8";

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

export function virtualPreviewDocument(): TreeDocument {
  const items = Array.from({ length: 1000 }, (_, index) => "第 " + String(index) + " 行");
  const list = node(LIST, ROOT + "." + PAGE + "." + LIST, "virtual-list", 10, {
    settings: { items, rowHeight: 32 },
    // 预览页没有树壳的窗口高度，显式给视口高度，让滚动容器有确定尺寸。
    slot: { size: { height: "100vh" } },
  });
  const page = node(PAGE, ROOT + "." + PAGE, "column", 10, {
    layout: [list],
    slot: { size: { width: "fill" } },
  });
  return {
    schema: "dendro.tree/1",
    version: 1,
    root: node(ROOT, ROOT, "app", 0, { layout: [page] }),
    pages: [{ id: PAGE, title: "虚拟列表", route: "/virtual" }],
    active: PAGE,
    data: {},
  };
}

export function mountVirtualPreview(container: HTMLElement): void {
  container.replaceChildren();
  mountTreeDocument(container, virtualPreviewDocument(), {
    event: () => undefined,
    loadMedia: () => Promise.reject(new Error("虚拟列表预览不加载媒体")),
    cleanup: () => undefined,
  });
}

// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { composeTree } from "../../../src/link/tree_compose";
import type { Document } from "../../../src/contract/tree_generated";
import type { RenderContext } from "../../../src/renderer/types";
import { mountTreeDocument } from "../../../src/app/tree/tree_renderer";
import {
  isTreeBuild,
  mountTreeBuild,
  type TreeBuildPayload,
} from "../../../src/app/tree/live";

// jsdom 下 Vite 会把 new URL(..., import.meta.url) 改写成 dev server 地址，用 node:path。
const HERE = dirname(fileURLToPath(import.meta.url));
const INPUT_PATH = resolve(HERE, "../../../src/generated/static-tree.json");

interface PageInput {
  name: string;
  base: unknown;
  partials: readonly unknown[];
}

function ideasDocument(): Document {
  const input = JSON.parse(readFileSync(INPUT_PATH, "utf8")) as {
    pages: PageInput[];
  };
  const page = input.pages.find((candidate) => candidate.name === "ideas");
  if (page === undefined) {
    throw new Error("生成输入里没有 ideas 页");
  }
  const composed = composeTree(page.base, page.partials);
  if (!composed.ok) {
    throw new Error("ideas compose 失败：" + JSON.stringify(composed.diagnostics));
  }
  return composed.document;
}

function context(): RenderContext {
  return {
    event: () => undefined,
    loadMedia: () => Promise.reject(new Error("测试不加载媒体")),
    cleanup: () => undefined,
  };
}

describe("真实页面：构建输入 → V1 文档 → DOM", () => {
  it("把 ideas 的空态结构挂出来：app / 导航 / 页面内容都在", () => {
    const container = document.createElement("div");
    document.body.append(container);

    const runtime = mountTreeDocument(container, ideasDocument(), context());

    expect(runtime.mounted).toBe(true);
    expect(container.querySelector('[data-type="app"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-type="page-link"]').length).toBe(4);
    expect(container.textContent).toContain("灵感");
    expect(container.textContent).toContain("还没有灵感。");
    expect(runtime.diagnostics).toEqual([]);

    runtime.dispose();
    container.remove();
  });

  it("ui.tree 的 base + partials 直接 compose 并挂载", () => {
    const input = JSON.parse(readFileSync(INPUT_PATH, "utf8")) as { pages: PageInput[] };
    const page = input.pages.find((candidate) => candidate.name === "ideas");
    if (page === undefined) {
      throw new Error("生成输入里没有 ideas 页");
    }
    const payload: TreeBuildPayload = {
      kind: "tree",
      base: page.base,
      partials: page.partials,
    };
    expect(isTreeBuild(payload)).toBe(true);
    expect(isTreeBuild({ kind: "view" })).toBe(false);

    const container = document.createElement("div");
    document.body.append(container);
    const runtime = mountTreeBuild(container, payload, context());

    expect(runtime.mounted).toBe(true);
    expect(container.querySelector('[data-type="app"]')).not.toBeNull();
    expect(container.textContent).toContain("还没有灵感。");

    runtime.dispose();
    container.remove();
  });
});

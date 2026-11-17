// @vitest-environment jsdom
/**
 * 端到端：SourceEngine.applyView 的增量提交经过 DocumentView 渲染后，DOM 统计应是
 * “0 新建 / 少量更新 / 大量复用”，而不是整页重建。
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createEngineFromView } from "../host/engine_sources";
import { DocumentView } from "./view";

const VIEW_FIXTURE_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../sdk/tests/fixtures/view.json",
);

function fixture(): Record<string, unknown> {
  const value: unknown = JSON.parse(readFileSync(VIEW_FIXTURE_PATH, "utf8"));
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("fixture 必须是对象");
  }
  return value as Record<string, unknown>;
}

function viewOf(patch: (value: Record<string, unknown>) => void): Record<string, unknown> {
  const value = structuredClone(fixture());
  patch(value);
  return value;
}

function renameTitle(value: Record<string, unknown>): void {
  const trees = (value.localTrees as Record<string, unknown>).trees as Record<string, unknown>[];
  const root = trees[1]?.root as Record<string, unknown>;
  const title = (root.children as Record<string, unknown>[])[0];
  if (title !== undefined) {
    title.props = { ...(title.props as Record<string, unknown>), text: "改过的标题" };
  }
}

describe("主会话视图增量：SourceEngine + DocumentView", () => {
  it("只改 props 的 view 走增量，DOM 0 新建、路径更新、其余复用", () => {
    const created = createEngineFromView(fixture());
    if (!created.ok) {
      throw new Error("视图应能建引擎: " + JSON.stringify(created.diagnostics));
    }
    const container = document.createElement("div");
    const view = new DocumentView(container, created.engine);
    expect(created.engine.metrics.renders).toBe(1);

    const result = created.engine.applyView(
      viewOf((value) => {
        value.version = 2;
        renameTitle(value);
      }),
    );

    expect(result.ok).toBe(true);
    expect(created.engine.metrics.fullUpdates).toBe(0);
    expect(created.engine.metrics.renders).toBe(2);
    expect(created.engine.metrics.lastRender).toMatchObject({ created: 0, removed: 0 });
    expect(created.engine.metrics.lastRender.updated).toBeGreaterThan(0);
    expect(created.engine.metrics.lastRender.reused).toBeGreaterThan(0);
    expect(container.textContent).toContain("改过的标题");
    view.dispose();
  });

  it("结构变化走增量：只新建新增节点，其余复用", () => {
    const created = createEngineFromView(fixture());
    if (!created.ok) {
      throw new Error("视图应能建引擎: " + JSON.stringify(created.diagnostics));
    }
    const container = document.createElement("div");
    const view = new DocumentView(container, created.engine);

    const result = created.engine.applyView(
      viewOf((value) => {
        value.version = 2;
        const trees = (value.localTrees as Record<string, unknown>).trees as Record<
          string,
          unknown
        >[];
        const root = trees[1]?.root as Record<string, unknown>;
        (root.children as Record<string, unknown>[]).push({
          id: "page.ideas.extra",
          kind: "dendro:text",
          owner: "ideas",
          props: { text: "新增" },
          children: [],
        });
      }),
    );

    expect(result.ok).toBe(true);
    expect(created.engine.metrics.fullUpdates).toBe(0);
    expect(created.engine.metrics.lastRender.created).toBeGreaterThan(0);
    expect(created.engine.metrics.lastRender.removed).toBe(0);
    expect(created.engine.metrics.lastRender.reused).toBeGreaterThan(0);
    expect(container.textContent).toContain("新增");
    view.dispose();
  });
});

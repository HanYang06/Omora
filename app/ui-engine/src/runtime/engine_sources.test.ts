import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { LocalTree } from "../link/types";
import { DocumentIndex } from "./document";
import { createEngineFromLocalTrees } from "./engine_sources";

const FIXTURE_PATH = fileURLToPath(
  new URL("../../../sdk/tests/fixtures/local-trees.json", import.meta.url),
);
const PAYLOAD: unknown = JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));

function payloadOf(value: unknown): { kind: string; seq: number; trees: LocalTree[] } {
  if (typeof value !== "object" || value === null) {
    throw new Error("fixture 应该是对象");
  }
  return value as { kind: string; seq: number; trees: LocalTree[] };
}

const FIXTURE = payloadOf(PAYLOAD);
const PAGE_IDEAS = { id: "page.ideas", label: "灵感", route: "/ideas", owner: "ideas" } as const;

function boot() {
  const created = createEngineFromLocalTrees(FIXTURE, {
    pages: [PAGE_IDEAS],
    active: PAGE_IDEAS.id,
  });
  if (!created.ok) {
    throw new Error("fixture 应能建来源引擎: " + JSON.stringify(created.diagnostics));
  }
  return created.engine;
}

function cardTree(owner: string, id: string, order: number): LocalTree {
  return {
    owner,
    mountAt: "ideas.feed",
    order,
    seq: 1,
    replace: false,
    root: {
      id,
      kind: "ideas:card",
      owner,
      props: { title: "来源卡 " + id },
      children: [],
    },
  };
}

function ids(engine: ReturnType<typeof boot>): DocumentIndex {
  return DocumentIndex.build(engine.session.document.root);
}

describe("createEngineFromLocalTrees：来源模式引擎", () => {
  it("从共享 local-trees fixture 建引擎：version 1、页面侧表/数据保留、来源数正确", () => {
    const engine = boot();
    expect(engine.session.document.version).toBe(1);
    expect(engine.session.active).toBe("page.ideas");
    expect(engine.session.pages).toHaveLength(1);
    expect(engine.session.document.root.id).toBe("dendro.window");
    expect(engine.sourceCount).toBe(3);
    const index = ids(engine);
    expect(index.get("ideas.feed")?.children.map((child) => child.id)).toEqual([
      "ideas.feed#42",
      "ideas.feed#7",
    ]);
    engine.dispose();
  });

  it("registerSource 走 host + engine：版本 +1、树更新、指标/审计/通知", () => {
    const engine = boot();
    const noted: string[][] = [];
    engine.onChange((_session, changed) => noted.push([...changed]));

    const result = engine.registerSource("extra", [cardTree("extra", "extra.card", 40)]);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.session.document.version).toBe(2);
    expect(ids(engine).get("extra.card")).toBeDefined();
    expect(engine.sourceCount).toBe(4);
    expect(engine.metrics.localTreeUpdates).toBe(1);
    expect(noted).toHaveLength(1);
    expect(engine.audit.entries().some((entry) => entry.kind === "apply")).toBe(true);
    engine.dispose();
  });

  it("removeSource：版本 +1、节点消失、host 级诊断带回", () => {
    const engine = boot();
    expect(engine.registerSource("extra", [cardTree("extra", "extra.card", 40)]).ok).toBe(true);

    const removed = engine.removeSource("extra");
    expect(removed.ok).toBe(true);
    if (!removed.ok) {
      return;
    }
    expect(removed.session.document.version).toBe(3);
    expect(ids(engine).get("extra.card")).toBeUndefined();
    expect(engine.sourceCount).toBe(3);
    engine.dispose();
  });

  it("applyLocalTrees 整组替换来源：来源数/版本/树都换", () => {
    const engine = boot();
    const replaced = engine.applyLocalTrees({
      kind: "local-trees",
      seq: 2,
      trees: [FIXTURE.trees[0]],
    });
    expect(replaced.ok).toBe(true);
    expect(engine.sourceCount).toBe(1);
    expect(engine.session.document.version).toBe(2);
    engine.dispose();
  });

  it("受限 requester：链接期 E-PERMISSION，建引擎失败", () => {
    const created = createEngineFromLocalTrees(FIXTURE, {
      requester: { owner: "outsider" },
    });
    expect(created.ok).toBe(false);
    if (!created.ok) {
      expect(created.diagnostics.some((diagnostic) => diagnostic.code === "E-PERMISSION")).toBe(
        true,
      );
    }
  });

  it("非法 payload：只回诊断，不建引擎", () => {
    const created = createEngineFromLocalTrees({});
    expect(created.ok).toBe(false);
    if (!created.ok) {
      expect(created.diagnostics[0]?.code).toBe("E-PAYLOAD");
    }
  });

  it("dispose：账本收口、幂等、之后来源操作拒绝", () => {
    const engine = boot();
    const cleaned = vi.fn();
    engine.registerCleanup(cleaned);
    const first = engine.dispose();
    expect(first.disposed).toBe(1);
    expect(cleaned).toHaveBeenCalledTimes(1);
    expect(engine.dispose()).toEqual({ disposed: 0, errors: [] });
    const after = engine.registerSource("later", []);
    expect(after.ok).toBe(false);
    if (!after.ok) {
      expect(after.diagnostics[0]?.code).toBe("E-PAYLOAD");
    }
  });
});

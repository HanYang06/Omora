import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SlotNode } from "../../src/contract/document";
import { DocumentIndex } from "../../src/engine/document/document";
import { createEngineFromView, type SourceEngine } from "../../src/host/engine_sources";
import { createLogger } from "../../src/app/log";
import clock from "../../src/app/runtime_sources/clock";
import { mountRuntimeSources, type RuntimeSource } from "../../src/app/runtime_sources";

const VIEW_FIXTURE_PATH = fileURLToPath(
  new URL("../../../sdk/tests/fixtures/view.json", import.meta.url),
);

function engineOf(): SourceEngine {
  const value: unknown = JSON.parse(readFileSync(VIEW_FIXTURE_PATH, "utf8"));
  const created = createEngineFromView(value);
  if (!created.ok) {
    throw new Error("fixture 应能建引擎: " + JSON.stringify(created.diagnostics));
  }
  return created.engine;
}

function rootOf(text: string, owner = "runtime.demo"): SlotNode {
  return {
    id: owner,
    kind: "dendro:text",
    owner,
    props: { text },
    children: [],
  };
}

function demoSource(overrides: Partial<RuntimeSource> = {}): RuntimeSource {
  return {
    owner: "runtime.demo",
    mountAt: "dendro.window.nav",
    order: 50,
    build: () => rootOf("DEMO"),
    ...overrides,
  };
}

const log = createLogger({ call: () => Promise.resolve({}) });

function index(engine: SourceEngine): DocumentIndex {
  return DocumentIndex.build(engine.session.document.root);
}

afterEach(() => {
  vi.useRealTimers();
});

describe("mountRuntimeSources：运行后来源", () => {
  it("把来源挂进窗口，engine 里能按 id 找到", () => {
    const engine = engineOf();

    const mounted = mountRuntimeSources(engine, [demoSource()], log);

    expect(index(engine).get("runtime.demo")?.props.text).toBe("DEMO");
    expect(mounted.owners()).toEqual(["runtime.demo"]);
    expect(engine.sources.has("runtime.demo")).toBe(true);
    mounted.dispose();
  });

  it("start 给的 push 会整组替换该来源的树", () => {
    const engine = engineOf();
    let push: ((root: SlotNode) => void) | null = null;

    mountRuntimeSources(
      engine,
      [
        demoSource({
          start(emit) {
            push = emit;
            return () => undefined;
          },
        }),
      ],
      log,
    );
    if (push === null) {
      throw new Error("start 应把 push 交出来");
    }

    (push as (root: SlotNode) => void)(rootOf("NEW"));

    expect(index(engine).get("runtime.demo")?.props.text).toBe("NEW");
    const trees = engine.sources.get("runtime.demo") ?? [];
    expect(trees[0]?.seq).toBe(2);
  });

  it("dispose 调用来源的清理函数", () => {
    const engine = engineOf();
    const cleanup = vi.fn();

    const mounted = mountRuntimeSources(engine, [demoSource({ start: () => cleanup })], log);
    mounted.dispose();

    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("单个来源坏掉不影响其他来源", () => {
    const engine = engineOf();
    const bad: RuntimeSource = {
      owner: "runtime.bad",
      mountAt: "dendro.window.nav",
      build: () => {
        throw new Error("坏来源");
      },
    };

    const mounted = mountRuntimeSources(engine, [bad, demoSource()], log);

    expect(engine.sources.has("runtime.bad")).toBe(false);
    expect(index(engine).get("runtime.demo")?.props.text).toBe("DEMO");
    mounted.dispose();
  });

  it("root.owner 与来源 owner 不一致时跳过", () => {
    const engine = engineOf();
    const mounted = mountRuntimeSources(
      engine,
      [demoSource({ build: () => rootOf("WRONG", "runtime.other") })],
      log,
    );

    expect(engine.sources.has("runtime.demo")).toBe(false);
    mounted.dispose();
  });
});

describe("运行后来源示例：clock", () => {
  it("build 出当前 HH:MM", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 15, 0, 34, 10));

    const root = clock.build();

    expect(root.kind).toBe("dendro:text");
    expect(root.owner).toBe("runtime.clock");
    expect(root.props.text).toBe("00:34");
  });

  it("start 每秒推一次，清理后停", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 15, 0, 34, 0));
    const pushes: SlotNode[] = [];
    const cleanup = clock.start?.((root) => pushes.push(root));
    if (cleanup === undefined) {
      throw new Error("clock 应该有 start");
    }

    vi.advanceTimersByTime(2500);
    cleanup();
    vi.advanceTimersByTime(3000);

    expect(pushes.length).toBe(2);
  });
});

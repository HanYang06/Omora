/**
 * S6 主会话视图：createEngineFromView / SourceEngine.applyView 的行为。
 *
 * 钉住：视图建引擎（局部树走链接器、页面侧表/数据/版本随视图）、新版本全量替换、
 * 旧版本被拒且注册表回滚、非法视图半状态不落地。
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createEngineFromView, type SourceEngine } from "./engine_sources";
import type { SlotNode } from "../contract/document";
import { DocumentIndex } from "../engine/document/document";
import type { LocalTree } from "../link/types";

const VIEW_FIXTURE_PATH = fileURLToPath(
  new URL("../../../sdk/tests/fixtures/view.json", import.meta.url),
);

function fixture(): Record<string, unknown> {
  const value: unknown = JSON.parse(readFileSync(VIEW_FIXTURE_PATH, "utf8"));
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("fixture 必须是对象");
  }
  return value as Record<string, unknown>;
}

function engineOf(value: unknown): SourceEngine {
  const created = createEngineFromView(value);
  if (!created.ok) {
    throw new Error("视图应能建引擎: " + JSON.stringify(created.diagnostics));
  }
  return created.engine;
}

function applied(result: ReturnType<SourceEngine["applyView"]>) {
  if (!result.ok) {
    throw new Error("applyView 应成功: " + JSON.stringify(result.diagnostics));
  }
  return result;
}

function failed(result: ReturnType<SourceEngine["applyView"]>) {
  if (result.ok) {
    throw new Error("applyView 应失败");
  }
  return result.diagnostics;
}

/** fixture 上做深拷改动；patch 收 Record，测试里按需再收窄。 */
function viewOf(patch: (value: Record<string, unknown>) => void): Record<string, unknown> {
  const value = structuredClone(fixture());
  patch(value);
  return value;
}

function sourcesOf(engine: SourceEngine): string {
  return JSON.stringify([...engine.sources.entries()]);
}

/** 改 ideas 页树的标题文本，用来证明视图真的换掉了树。 */
function renameIdeasTitle(value: Record<string, unknown>): void {
  const trees = (value.localTrees as Record<string, unknown>).trees as Record<string, unknown>[];
  const root = trees[1]?.root as Record<string, unknown>;
  const children = root.children as Record<string, unknown>[];
  const title = children[0] as Record<string, unknown>;
  title.props = { ...(title.props as Record<string, unknown>), text: "改过的标题" };
}

describe("createEngineFromView：视图建引擎", () => {
  it("局部树经链接器挂进窗口骨架，页面侧表 / 数据 / 版本随视图", () => {
    const engine = engineOf(fixture());
    const index = DocumentIndex.build(engine.session.document.root);

    expect(engine.session.document.version).toBe(1);
    expect(engine.session.active).toBe("page.ideas");
    expect(engine.session.pages.map((page) => page.id)).toEqual(["page.ideas", "page.projects"]);
    expect(engine.session.data).toEqual({});
    expect(engine.session.document.root.id).toBe("dendro.window");
    expect(index.get("ui.nav.ideas")).toBeDefined();
    expect(index.get("page.ideas.title")?.props.text).toBe("灵感");
  });
});

describe("applyView：整份视图替换", () => {
  it("新版本：树 / active / data 一起换，fullUpdates +1，changed 是新根", () => {
    const engine = engineOf(fixture());
    const changes: string[][] = [];
    engine.onChange((_session, changed) => changes.push([...changed]));

    const result = applied(
      engine.applyView(
        viewOf((value) => {
          value.version = 2;
          value.active = "page.projects";
          value.data = { "ideas.feed": { revision: 1, value: "x" } };
          renameIdeasTitle(value);
        }),
      ),
    );

    expect(result.changed).toEqual(["dendro.window"]);
    expect(engine.session.document.version).toBe(2);
    expect(engine.session.active).toBe("page.projects");
    expect(engine.session.data).toEqual({ "ideas.feed": { revision: 1, value: "x" } });
    const index = DocumentIndex.build(engine.session.document.root);
    expect(index.get("page.ideas.title")?.props.text).toBe("改过的标题");
    expect(engine.metrics).toMatchObject({ version: 2, fullUpdates: 1, rejections: 0 });
    expect(changes).toEqual([["dendro.window"]]);
  });

  it("只改 props 的视图走 ops，不全量替换", () => {
    const engine = engineOf(fixture());

    const result = applied(
      engine.applyView(
        viewOf((value) => {
          value.version = 2;
          renameIdeasTitle(value);
        }),
      ),
    );

    expect(result.changed).toEqual(["page.ideas.title"]);
    expect(engine.session.document.version).toBe(2);
    expect(engine.metrics).toMatchObject({ version: 2, fullUpdates: 0, opsBatches: 1 });
    const index = DocumentIndex.build(engine.session.document.root);
    expect(index.get("page.ideas.title")?.props.text).toBe("改过的标题");
  });

  it("旧版本：E-VERSION 拒绝，会话与注册表都回滚", () => {
    const engine = engineOf(fixture());
    applied(engine.applyView(viewOf((value) => (value.version = 2))));
    const sessionBefore = structuredClone(engine.session);
    const sourcesBefore = sourcesOf(engine);

    const diagnostics = failed(
      engine.applyView(
        viewOf((value) => {
          value.version = 1;
          renameIdeasTitle(value);
        }),
      ),
    );

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["E-VERSION"]);
    expect(engine.session).toEqual(sessionBefore);
    expect(sourcesOf(engine)).toBe(sourcesBefore);
    expect(engine.metrics).toMatchObject({
      version: 2,
      fullUpdates: 0,
      opsBatches: 1,
      rejections: 1,
    });
  });

  it("非法视图：E-PAYLOAD 拒绝，会话与注册表不变", () => {
    const engine = engineOf(fixture());
    const sourcesBefore = sourcesOf(engine);

    const diagnostics = failed(engine.applyView(viewOf((value) => (value.schema = "bad"))));

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["E-PAYLOAD"]);
    expect(engine.session.document.version).toBe(1);
    expect(sourcesOf(engine)).toBe(sourcesBefore);
  });

  it("dispose 后拒绝：E-PAYLOAD，不再改会话", () => {
    const engine = engineOf(fixture());
    engine.dispose();

    const diagnostics = failed(engine.applyView(fixture()));

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["E-PAYLOAD"]);
  });
});

function runtimeTree(text: string): LocalTree {
  const root: SlotNode = {
    id: "runtime.test",
    kind: "dendro:text",
    owner: "runtime.test",
    props: { text },
    children: [],
  };
  return {
    owner: "runtime.test",
    root,
    mountAt: "dendro.window.nav",
    order: 99,
    seq: 0,
    replace: false,
  };
}

describe("applyView：运行后来源的保留", () => {
  it("keepOwners 里的来源不随主视图全量替换消失", () => {
    const engine = engineOf(fixture());
    applied(engine.applyView(viewOf((value) => (value.version = 2))));
    const registered = engine.registerSource("runtime.test", [runtimeTree("RUNTIME")]);
    if (!registered.ok) {
      throw new Error("来源应注册成功: " + JSON.stringify(registered.diagnostics));
    }

    applied(
      engine.applyView(
        viewOf((value) => {
          value.version = engine.session.document.version + 1;
          value.active = "page.projects";
        }),
        { keepOwners: ["runtime.test"] },
      ),
    );

    const index = DocumentIndex.build(engine.session.document.root);
    expect(index.get("runtime.test")?.props.text).toBe("RUNTIME");
    expect(engine.sources.has("runtime.test")).toBe(true);
    expect(engine.session.active).toBe("page.projects");
  });

  it("不传 keepOwners 时来源随全量替换消失", () => {
    const engine = engineOf(fixture());
    engine.registerSource("runtime.test", [runtimeTree("RUNTIME")]);

    applied(engine.applyView(viewOf((value) => (value.version = 2))));

    expect(DocumentIndex.build(engine.session.document.root).get("runtime.test")).toBeUndefined();
    expect(engine.sources.has("runtime.test")).toBe(false);
  });

  it("旧版本被拒回滚时，运行后来源仍在", () => {
    const engine = engineOf(fixture());
    applied(engine.applyView(viewOf((value) => (value.version = 2))));
    engine.registerSource("runtime.test", [runtimeTree("RUNTIME")]);

    const diagnostics = failed(
      engine.applyView(
        viewOf((value) => (value.version = 1)),
        { keepOwners: ["runtime.test"] },
      ),
    );

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["E-VERSION"]);
    expect(engine.sources.has("runtime.test")).toBe(true);
    expect(DocumentIndex.build(engine.session.document.root).get("runtime.test")).toBeDefined();
  });
});

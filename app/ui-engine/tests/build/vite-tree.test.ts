import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Plugin } from "vite";
import { afterAll, describe, expect, it } from "vitest";
import {
  defaultTreeInputPath,
  readTreeInput,
  treeArtifactsPlugin,
} from "../../src/build/vite-tree";

interface EmittedAsset {
  type: "asset";
  fileName: string;
  source: string;
}

const tempDirs: string[] = [];

function tempJsonFile(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "omora-tree-artifacts-"));
  tempDirs.push(dir);
  const path = join(dir, "static-tree.json");
  writeFileSync(path, content, "utf8");
  return path;
}

function runBuildStart(plugin: Plugin): EmittedAsset[] {
  const hook = plugin.buildStart;
  if (typeof hook !== "function") {
    throw new Error("buildStart 应该是函数");
  }
  const emitted: EmittedAsset[] = [];
  const callable = hook as unknown as (this: unknown) => void;
  callable.call({
    emitFile: (file: EmittedAsset) => {
      emitted.push(file);
      return "asset-id";
    },
  });
  return emitted;
}

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("treeArtifactsPlugin：构建期产物", () => {
  it("默认输入是生成的 static-tree.json", () => {
    expect(defaultTreeInputPath().replaceAll("\\", "/")).toContain(
      "app/ui-engine/src/generated/static-tree.json",
    );
  });

  it("真实输入：每页一份文档 + manifest 都 emit 出去", () => {
    const emitted = runBuildStart(treeArtifactsPlugin());

    const files = emitted.map((file) => file.fileName);
    expect(files).toEqual([
      "tree/pages/ideas.json",
      "tree/pages/projects.json",
      "tree/pages/requirements.json",
      "tree/pages/plugins.json",
      "tree/manifest.json",
    ]);
    const manifest = JSON.parse(emitted.at(-1)?.source ?? "{}") as {
      default: string;
      pages: { file: string }[];
    };
    expect(manifest.default).toBe("ideas");
    expect(manifest.pages.map((page) => page.file)).toEqual(files.slice(0, -1));
  });

  it("产物是合法 JSON 文档：schema / pages / active 对得上", () => {
    const emitted = runBuildStart(treeArtifactsPlugin());
    const ideas = emitted.find((file) => file.fileName === "tree/pages/ideas.json");
    expect(ideas).toBeDefined();
    const document = JSON.parse(ideas?.source ?? "{}") as {
      schema: string;
      root: { kind: string };
      pages: { id: string; title: string }[];
      active: string;
    };
    expect(document.schema).toBe("dendro.tree/1");
    expect(document.root.kind).toBe("app");
    expect(document.pages).toHaveLength(1);
    expect(document.active).toBe(document.pages[0]?.id);
    expect(document.pages[0]?.title).toBe("灵感");
  });

  it("组合失败：buildStart 抛错，构建失败", () => {
    const broken = JSON.stringify({
      format: "omora.tree.build/1",
      default: "ideas",
      pages: [
        {
          name: "ideas",
          title: "灵感",
          route: "/ideas",
          base: {
            schema: "dendro.tree/1",
            version: 1,
            root: {
              id: "aaaaaaaaaaaaaaaa",
              chain: "aaaaaaaaaaaaaaaa",
              kind: "app",
              order: 0,
              layout: [],
              settings: {},
              bind: {},
              on: {},
              emit: {},
            },
            pages: [],
            active: "",
            data: {},
          },
          partials: [
            {
              schema: "dendro.tree/1",
              source: "ui",
              mount: { parent: "ffffffffffffffff", mode: "new" },
              root: {
                id: "bbbbbbbbbbbbbbbb",
                chain: "aaaaaaaaaaaaaaaa.bbbbbbbbbbbbbbbb",
                kind: "text",
                order: 10,
                layout: [],
                settings: {},
                bind: {},
                on: {},
                emit: {},
              },
            },
          ],
        },
      ],
    });

    const plugin = treeArtifactsPlugin({ inputPath: tempJsonFile(broken) });
    expect(() => runBuildStart(plugin)).toThrow(/V1 树构建产物失败/);
  });

  it("输入读不到：readTreeInput 抛错", () => {
    expect(() => readTreeInput(join(tmpdir(), "omora-missing-static-tree.json"))).toThrow(
      /读取 V1 构建输入失败/,
    );
  });
});

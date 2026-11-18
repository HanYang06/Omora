import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Plugin } from "vite";
import { afterAll, describe, expect, it } from "vitest";
import { defaultTreeInputPath } from "../../src/build/vite-tree";
import { loadTreeAssets, treeAsset, treeDevPlugin } from "../../src/build/vite-tree-dev";

const tempDirs: string[] = [];

function tempJsonFile(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "omora-tree-dev-"));
  tempDirs.push(dir);
  const path = join(dir, "static-tree.json");
  writeFileSync(path, content, "utf8");
  return path;
}

interface FakeResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  setHeader(name: string, value: string): void;
  end(body: string): void;
}

interface Handler {
  (req: { url: string }, res: FakeResponse, next: () => void): void;
}

function middlewareOf(plugin: Plugin): Handler {
  const configure = plugin.configureServer as unknown as (server: {
    middlewares: { use(handler: Handler): void };
  }) => void;
  let handler: Handler | undefined;
  configure({
    middlewares: {
      use(value: Handler) {
        handler = value;
      },
    },
  });
  if (handler === undefined) {
    throw new Error("插件没有注册 middleware");
  }
  return handler;
}

function response(): FakeResponse {
  return {
    statusCode: 200,
    headers: {},
    body: "",
    setHeader(name, value) {
      this.headers[name] = value;
    },
    end(body) {
      this.body = body;
    },
  };
}

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("treeDevPlugin：dev 下供 V1 产物", () => {
  it("真实输入：manifest 与每页文档都能按 URL 取到", () => {
    const assets = loadTreeAssets(defaultTreeInputPath());
    const manifest = JSON.parse(assets.manifest) as { default: string; pages: { file: string }[] };

    expect(manifest.default).toBe("ideas");
    expect(assets.pages.size).toBe(manifest.pages.length);
    const ideas = treeAsset("/tree/pages/ideas.json", assets);
    expect(ideas).toBeDefined();
    expect(JSON.parse(ideas ?? "{}")).toMatchObject({ schema: "dendro.tree/1" });
  });

  it("treeAsset 只认 /tree/ 下的路径，查询串不影响", () => {
    const assets = loadTreeAssets(defaultTreeInputPath());

    expect(treeAsset("/tree/manifest.json?t=1", assets)).toBe(assets.manifest);
    expect(treeAsset("/tree/nope.json", assets)).toBeUndefined();
    expect(treeAsset("/other/manifest.json", assets)).toBeUndefined();
  });

  it("输入坏了：loadTreeAssets 抛错并带诊断", () => {
    const path = tempJsonFile(
      JSON.stringify({ format: "omora.tree.build/1", default: "x", pages: [] }),
    );

    expect(() => loadTreeAssets(path)).toThrow(/V1 树构建产物失败/);
  });

  it("middleware 返回 JSON；未知路径交给 next", () => {
    const handler = middlewareOf(treeDevPlugin());

    const manifest = response();
    let nextCalled = false;
    handler({ url: "/tree/manifest.json" }, manifest, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(false);
    expect(manifest.statusCode).toBe(200);
    expect(JSON.parse(manifest.body)).toMatchObject({ default: "ideas" });

    const other = response();
    let passed = false;
    handler({ url: "/tree/nope.json" }, other, () => {
      passed = true;
    });
    expect(passed).toBe(true);
  });

  it("非 /tree/ 请求直接放行", () => {
    const handler = middlewareOf(treeDevPlugin());
    let passed = false;

    handler({ url: "/src/app/main.ts" }, response(), () => {
      passed = true;
    });

    expect(passed).toBe(true);
  });
});

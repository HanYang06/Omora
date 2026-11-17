/**
 * Vite dev adapter：`vite dev` 下把 V1 构建产物挂到 `/tree/` 上。
 *
 * 构建期插件（`vite-tree.ts`）只 emitFile；dev 没有 dist，所以这里按请求现算，
 * 输入文件的 mtime / size 变了才重算。产物形状与构建期完全一致，预览看到的就是
 * `vite build` 会写进 `dist/tree/` 的东西。
 */

import { readFileSync, statSync } from "node:fs";
import type { Plugin } from "vite";
import { knownTreeKinds } from "../components/tree_kinds";
import { buildTreeArtifacts } from "./tree/artifacts";
import { defaultTreeInputPath, formatTreeFailure } from "./vite-tree";

export interface TreeAssets {
  manifest: string;
  /** URL（`/tree/pages/<name>.json`）→ 文档 JSON。 */
  pages: ReadonlyMap<string, string>;
}

export interface TreeDevOptions {
  /** 测试用：换一份输入；默认用生成的 `static-tree.json`。 */
  inputPath?: string;
}

/** 读输入、组合、校验；失败抛带诊断的错。 */
export function loadTreeAssets(inputPath: string): TreeAssets {
  const value: unknown = JSON.parse(readFileSync(inputPath, "utf8"));
  const result = buildTreeArtifacts(value, { kinds: knownTreeKinds() });
  if (!result.ok) {
    throw new Error(formatTreeFailure(inputPath, result.diagnostics));
  }
  return {
    manifest: result.manifestJson,
    pages: new Map(result.documents.map((document) => ["/" + document.file, document.json])),
  };
}

/** URL → 产物内容；不是 `/tree/` 下的路径返回 undefined。 */
export function treeAsset(url: string, assets: TreeAssets): string | undefined {
  const path = url.split("?")[0] ?? "";
  if (path === "/tree/manifest.json") {
    return assets.manifest;
  }
  return assets.pages.get(path);
}

export function treeDevPlugin(options: TreeDevOptions = {}): Plugin {
  let cache: { key: string; assets: TreeAssets } | null = null;
  return {
    name: "omora-tree-artifacts-dev",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? "";
        if (!url.startsWith("/tree/")) {
          next();
          return;
        }
        try {
          const inputPath = options.inputPath ?? defaultTreeInputPath();
          const stat = statSync(inputPath);
          const key = String(stat.mtimeMs) + ":" + String(stat.size);
          if (cache === null || cache.key !== key) {
            cache = { key, assets: loadTreeAssets(inputPath) };
          }
          const body = treeAsset(url, cache.assets);
          if (body === undefined) {
            next();
            return;
          }
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(body);
        } catch (error) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          res.end("V1 树产物生成失败：" + String(error));
        }
      });
    },
  };
}

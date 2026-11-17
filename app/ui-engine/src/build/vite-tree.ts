/**
 * Vite adapter：构建期把 `static-tree.json` 组合成每页一份 V1 文档，写进 `dist/tree/`。
 *
 * 编译 / 组合核心在 `src/build/tree/artifacts.ts`（纯函数）；这里只决定「什么时候读、
 * 产物写到哪」。只在 build 期跑，不进 dev 的请求路径，也不进客户端模块图。
 *
 * 输入是 Python 生成的（`scripts/static_tree.py`），所以 `vite build` 本身不需要 Python：
 * 它只读已提交的输入，组合、校验、落盘。
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { buildTreeArtifacts, type TreeBuildDiagnostic } from "./tree/artifacts";

const INPUT_URL = new URL("../generated/static-tree.json", import.meta.url);

/** 默认输入路径：与 import.meta.url 相对，避免依赖 cwd。 */
export function defaultTreeInputPath(): string {
  return fileURLToPath(INPUT_URL);
}

/** 读构建输入；读不到 / 不是 JSON 直接抛（构建期不要静默空产物）。 */
export function readTreeInput(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch (error) {
    throw new Error(`读取 V1 构建输入失败（${path}）：${String(error)}`, { cause: error });
  }
}

/** 失败信息：输入路径 + 每条诊断的码与现场。 */
export function formatTreeFailure(
  path: string,
  diagnostics: readonly TreeBuildDiagnostic[],
): string {
  const detail = diagnostics
    .map((diagnostic) => `  ${diagnostic.code} @ ${diagnostic.path}: ${diagnostic.message}`)
    .join("\n");
  return `V1 树构建产物失败（${path}）：\n${detail}`;
}

export interface TreeArtifactsOptions {
  /** 测试用：换一份输入；默认用生成的 `static-tree.json`。 */
  inputPath?: string;
}

/**
 * 构建期插件：buildStart 组合每页文档并 emitFile 到 `dist/tree/`。
 * 组合失败 / 输入坏了都抛错，让 `vite build` 失败——门禁不靠事后脚本兜。
 */
export function treeArtifactsPlugin(options: TreeArtifactsOptions = {}): Plugin {
  return {
    name: "omora-tree-artifacts",
    apply: "build",
    buildStart() {
      const inputPath = options.inputPath ?? defaultTreeInputPath();
      const result = buildTreeArtifacts(readTreeInput(inputPath));
      if (!result.ok) {
        throw new Error(formatTreeFailure(inputPath, result.diagnostics));
      }
      for (const document of result.documents) {
        this.emitFile({ type: "asset", fileName: document.file, source: document.json });
      }
      this.emitFile({ type: "asset", fileName: "tree/manifest.json", source: result.manifestJson });
    },
  };
}

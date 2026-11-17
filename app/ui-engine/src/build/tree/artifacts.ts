/**
 * 构建期产物：把 `scripts/static_tree.py` 产的输入 compose 成「每页一份 `dendro.tree/1`
 * 文档」，外加一份 manifest。纯函数，不做 IO；Vite 插件只负责读输入、写产物。
 *
 * 为什么按页拆：一棵树只有一份文档时，页数一多就是一个巨无霸；每页一份文档各自带骨架、
 * 导航与页面内容，按路由取用，文件大小只跟单页结构有关，不跟页数有关。
 *
 * 产物形状（`dist/tree/`）：
 * - `manifest.json`：default + 每页的 name / title / route / file / hash / nodes；
 * - `pages/<name>.json`：自包含的 `dendro.tree/1` 文档（base + 局部树已组合）。
 *
 * 失败语义：任何一页 compose 失败都让整次构建失败（不产出半套产物）；诊断带页下标与
 * 组合器原诊断路径，能给到具体节点。
 */

import { createHash } from "node:crypto";
import { validateTree } from "../../contract/tree";
import type { Node } from "../../contract/tree_generated";
import { composeTree } from "./compose";

/** 构建输入的格式标记；和 Python `tree_build.FORMAT` 同值。 */
export const TREE_BUILD_FORMAT = "omora.tree.build/1";

/** 一条构建诊断；path 是「输入定位 + 组合器原路径」。 */
export interface TreeBuildDiagnostic {
  code: string;
  path: string;
  message: string;
}

/** 一页的构建输入：base 文档 + 挂进它的局部树。 */
export interface TreePageInput {
  name: string;
  title: string;
  route: string;
  base: unknown;
  partials: readonly unknown[];
}

/** 整份构建输入。 */
export interface TreeBuildInput {
  format: string;
  default: string;
  pages: readonly TreePageInput[];
}

/** 一页的产物：文件名 + 内容 + 内容哈希 + 节点数。 */
export interface TreeArtifact {
  name: string;
  title: string;
  route: string;
  file: string;
  hash: string;
  nodes: number;
  json: string;
}

/** manifest 里的一页（产物去掉正文）。 */
export interface TreeManifestPage {
  name: string;
  title: string;
  route: string;
  file: string;
  hash: string;
  nodes: number;
}

/** 产物清单：运行时按 default / route 找文件。 */
export interface TreeManifest {
  format: string;
  default: string;
  pages: TreeManifestPage[];
}

export type TreeArtifactsResult =
  | { ok: true; documents: TreeArtifact[]; manifest: TreeManifest; manifestJson: string }
  | { ok: false; diagnostics: TreeBuildDiagnostic[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function fail(
  code: string,
  path: string,
  message: string,
): {
  ok: false;
  diagnostics: TreeBuildDiagnostic[];
} {
  return { ok: false, diagnostics: [{ code, path, message }] };
}

/** 输入信封校验；错误全部收集，一次给出。 */
function parseInput(
  value: unknown,
): { ok: true; input: TreeBuildInput } | { ok: false; diagnostics: TreeBuildDiagnostic[] } {
  if (!isRecord(value)) {
    return fail("E-BUILD-INPUT", "", "构建输入必须是对象");
  }
  const diagnostics: TreeBuildDiagnostic[] = [];
  if (value.format !== TREE_BUILD_FORMAT) {
    diagnostics.push({
      code: "E-BUILD-INPUT",
      path: "format",
      message: `format 必须是 "${TREE_BUILD_FORMAT}"`,
    });
  }
  const rawPages = value.pages;
  if (!Array.isArray(rawPages) || rawPages.length === 0) {
    diagnostics.push({ code: "E-BUILD-INPUT", path: "pages", message: "pages 必须是非空数组" });
  }
  const pages: TreePageInput[] = [];
  const seen = new Set<string>();
  if (Array.isArray(rawPages)) {
    rawPages.forEach((entry: unknown, index) => {
      const where = `pages[${String(index)}]`;
      if (!isRecord(entry)) {
        diagnostics.push({ code: "E-BUILD-INPUT", path: where, message: "页面必须是对象" });
        return;
      }
      const name = nonEmptyString(entry.name);
      const title = nonEmptyString(entry.title);
      const route = nonEmptyString(entry.route);
      if (name === null) {
        diagnostics.push({
          code: "E-BUILD-INPUT",
          path: `${where}.name`,
          message: "name 必须是非空字符串",
        });
        return;
      }
      if (seen.has(name)) {
        diagnostics.push({
          code: "E-BUILD-INPUT",
          path: `${where}.name`,
          message: `重复页面名: ${name}`,
        });
        return;
      }
      seen.add(name);
      if (title === null) {
        diagnostics.push({
          code: "E-BUILD-INPUT",
          path: `${where}.title`,
          message: "title 必须是非空字符串",
        });
      }
      if (route === null) {
        diagnostics.push({
          code: "E-BUILD-INPUT",
          path: `${where}.route`,
          message: "route 必须是非空字符串",
        });
      }
      if (!Array.isArray(entry.partials)) {
        diagnostics.push({
          code: "E-BUILD-INPUT",
          path: `${where}.partials`,
          message: "partials 必须是数组",
        });
      } else {
        pages.push({
          name,
          title: title ?? name,
          route: route ?? `/${name}`,
          base: entry.base,
          partials: entry.partials,
        });
      }
    });
  }
  const fallback = pages[0]?.name ?? "";
  const defaultValue = nonEmptyString(value.default) ?? fallback;
  if (defaultValue === "" || !seen.has(defaultValue)) {
    diagnostics.push({
      code: "E-BUILD-INPUT",
      path: "default",
      message: `default 必须是 pages 里的一个 name`,
    });
  }
  if (diagnostics.length > 0) {
    return { ok: false, diagnostics };
  }
  return { ok: true, input: { format: TREE_BUILD_FORMAT, default: defaultValue, pages } };
}

/** 产物文件名：`tree/pages/<name>.json`。 */
export function artifactFile(name: string): string {
  return `tree/pages/${name}.json`;
}

function hashOf(json: string): string {
  return createHash("sha256").update(json).digest("hex").slice(0, 16);
}

/** 文档的节点数（layout 递归；模板子树将来也算）。 */
export function countNodes(node: Node): number {
  let total = 1;
  for (const child of node.layout) {
    total += countNodes(child);
  }
  return total;
}

/**
 * 输入 → 每页文档 + manifest；任何一页失败就整次失败（不产出半套产物）。
 * 同一份输入永远得到同一批文件名、同一批 hash。
 */
export function buildTreeArtifacts(value: unknown): TreeArtifactsResult {
  const parsed = parseInput(value);
  if (!parsed.ok) {
    return parsed;
  }
  const documents: TreeArtifact[] = [];
  const diagnostics: TreeBuildDiagnostic[] = [];
  parsed.input.pages.forEach((page, index) => {
    const composed = composeTree(page.base, page.partials);
    if (!composed.ok) {
      for (const diagnostic of composed.diagnostics) {
        diagnostics.push({
          code: diagnostic.code,
          path: `pages[${String(index)}].${diagnostic.path}`,
          message: diagnostic.message,
        });
      }
      return;
    }
    const shape = validateTree(composed.document, "document");
    if (shape.length > 0) {
      for (const diagnostic of shape) {
        diagnostics.push({
          code: diagnostic.code,
          path: `pages[${String(index)}].${diagnostic.path}`,
          message: diagnostic.message,
        });
      }
      return;
    }
    const document = composed.document;
    const json = JSON.stringify(document);
    documents.push({
      name: page.name,
      title: page.title,
      route: page.route,
      file: artifactFile(page.name),
      hash: hashOf(json),
      nodes: countNodes(document.root),
      json,
    });
  });
  if (diagnostics.length > 0 || documents.length !== parsed.input.pages.length) {
    return { ok: false, diagnostics };
  }
  const manifest: TreeManifest = {
    format: TREE_BUILD_FORMAT,
    default: parsed.input.default,
    pages: documents.map((document) => ({
      name: document.name,
      title: document.title,
      route: document.route,
      file: document.file,
      hash: document.hash,
      nodes: document.nodes,
    })),
  };
  return { ok: true, documents, manifest, manifestJson: JSON.stringify(manifest) };
}

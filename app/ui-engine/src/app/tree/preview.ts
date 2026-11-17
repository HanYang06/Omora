/**
 * `?engine=tree` 预览：读构建产物（`/tree/manifest.json` + 页面文档）→ V1 运行时 → DOM。
 *
 * 预览只负责"找文件、挂上去、报错要看得见"：不组合结构（那是构建期的事），
 * 不接 Python、不发消息。dev 下由 `build/vite-tree-dev.ts` 供这几份文件，
 * `vite preview` / 部署下就是 `dist/tree/`。
 *
 * 没有 handler 的导航是禁用态——事件绑定属于运行时那一半，预览不伪造。
 */

import type { RenderContext } from "../../renderer/types";
import { mountTreeDocument } from "./tree_renderer";

export interface TreePreviewHandle {
  dispose(): void;
}

export interface TreePreviewOptions {
  /** 产物根路径；默认 `/tree`。 */
  baseUrl?: string;
  /** 看哪一页；默认 manifest 的 `default`。 */
  page?: string;
}

interface ManifestPage {
  name: string;
  title: string;
  route: string;
  file: string;
}

interface Manifest {
  default: string;
  pages: ManifestPage[];
}

/** 每个容器只保留一个预览实例：重复 mount 先撤旧的，避免叠 DOM。 */
const activeMounts = new WeakMap<HTMLElement, TreePreviewHandle>();

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(url + " 返回 " + String(response.status));
  }
  return response.json();
}

function manifestOf(value: unknown): Manifest {
  if (typeof value !== "object" || value === null) {
    throw new Error("manifest 不是对象");
  }
  const record = value as Record<string, unknown>;
  const pages = record.pages;
  if (typeof record.default !== "string" || !Array.isArray(pages)) {
    throw new Error("manifest 缺少 default / pages");
  }
  const parsed: ManifestPage[] = [];
  for (const page of pages) {
    if (typeof page !== "object" || page === null) {
      continue;
    }
    const entry = page as Record<string, unknown>;
    if (typeof entry.name === "string" && typeof entry.file === "string") {
      parsed.push({
        name: entry.name,
        title: typeof entry.title === "string" ? entry.title : entry.name,
        route: typeof entry.route === "string" ? entry.route : "/" + entry.name,
        file: entry.file,
      });
    }
  }
  if (!parsed.some((page) => page.name === record.default)) {
    throw new Error("manifest.default 不在 pages 里");
  }
  return { default: record.default, pages: parsed };
}

function context(): RenderContext {
  return {
    event: (handler) => {
      console.info("[omora] V1 预览事件:", handler);
    },
    loadMedia: () => Promise.reject(new Error("V1 预览不加载媒体")),
    cleanup: () => undefined,
  };
}

/**
 * 在 `container` 上挂一页 V1 文档；失败直接 reject（调用方负责把错误显示出来）。
 * 同一容器重复调用会先 dispose 上一个实例。
 */
export async function mountTreePreview(
  container: HTMLElement,
  options: TreePreviewOptions = {},
): Promise<TreePreviewHandle> {
  activeMounts.get(container)?.dispose();
  activeMounts.delete(container);

  const base = (options.baseUrl ?? "/tree").replace(/\/$/, "");
  const manifest = manifestOf(await fetchJson(base + "/manifest.json"));
  const name = options.page ?? manifest.default;
  const page = manifest.pages.find((candidate) => candidate.name === name);
  if (page === undefined) {
    throw new Error("manifest 里没有页面：" + name);
  }
  const documentValue = await fetchJson("/" + page.file);

  const runtime = mountTreeDocument(container, documentValue, context());
  const handle: TreePreviewHandle = {
    dispose() {
      if (activeMounts.get(container) === handle) {
        activeMounts.delete(container);
      }
      runtime.dispose();
      container.replaceChildren();
    },
  };
  activeMounts.set(container, handle);
  return handle;
}

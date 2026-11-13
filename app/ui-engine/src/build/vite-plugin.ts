import type { Plugin } from "vite";
import { compileBootSkeletonInNode } from "./node";

/**
 * Vite adapter：构建 / dev 期把启动骨架编译进 index.html。
 *
 * 编译核心在 `src/build/`；这里只决定"什么时候编译、注进哪里"，不碰 kind。
 * 每次请求都重新编译（不缓存）：dev 下改了骨架或文案，刷新就能看到，不会有旧 HTML。
 */

export type SkeletonCompiler = () => string | Promise<string>;

const ROOT_EMPTY = '<div id="root"></div>';

export function staticSkeletonPlugin(
  compile: SkeletonCompiler = compileBootSkeletonInNode,
): Plugin {
  return {
    name: "omora-static-skeleton",
    async transformIndexHtml(html) {
      if (!html.includes(ROOT_EMPTY)) {
        return html;
      }
      const skeleton = await compile();
      return html.replace(ROOT_EMPTY, `<div id="root">${skeleton}</div>`);
    },
  };
}

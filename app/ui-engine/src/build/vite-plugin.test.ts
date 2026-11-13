import { describe, expect, it, vi } from "vitest";
import { staticSkeletonPlugin } from "./vite-plugin";

type TransformHook = (html: string) => string | Promise<string>;

function hookOf(plugin: ReturnType<typeof staticSkeletonPlugin>): TransformHook {
  const hook = plugin.transformIndexHtml;
  if (typeof hook !== "function") {
    throw new Error("transformIndexHtml 应该是函数");
  }
  return hook as unknown as TransformHook;
}

const PAGE = '<body><div id="root"></div><script type="module" src="/main.js"></script></body>';

describe("staticSkeletonPlugin", () => {
  it("把编译出的骨架注入空的 #root，其余 HTML 不动", async () => {
    const compile = vi.fn(async () => '<div class="omora-app" data-connection="idle"></div>');
    const html = await hookOf(staticSkeletonPlugin(compile))(PAGE);
    expect(html).toBe(
      '<body><div id="root"><div class="omora-app" data-connection="idle"></div></div>' +
        '<script type="module" src="/main.js"></script></body>',
    );
    expect(compile).toHaveBeenCalledTimes(1);
  });

  it("#root 里已经有东西就不覆盖，也不编译", async () => {
    const compile = vi.fn(async () => "不该出现");
    const page = '<div id="root"><p>已有内容</p></div>';
    expect(await hookOf(staticSkeletonPlugin(compile))(page)).toBe(page);
    expect(compile).not.toHaveBeenCalled();
  });

  it("默认接引擎的 Node 宿主编译启动骨架", async () => {
    const html = await hookOf(staticSkeletonPlugin())(PAGE);
    expect(html).toContain('class="omora-app"');
    expect(html).toContain("omora-shell-nav");
  });
  it("每次都重新编译，dev 下改了骨架刷新就能看到", async () => {
    const compile = vi.fn(async () => '<div class="omora-app"></div>');
    const hook = hookOf(staticSkeletonPlugin(compile));
    await hook(PAGE);
    await hook(PAGE);
    expect(compile).toHaveBeenCalledTimes(2);
  });
});

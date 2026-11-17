// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Document, Node } from "../../contract/tree_generated";
import { mountTreePreview } from "./preview";

const ROOT = "aaaaaaaaaaaaaaaa";
const PAGE = "bbbbbbbbbbbbbbbb";
const TEXT = "cccccccccccccccc";

function node(
  id: string,
  chain: string,
  kind: string,
  order: number,
  over: Partial<Node> = {},
): Node {
  return {
    id,
    chain,
    kind,
    order,
    layout: [],
    settings: {},
    bind: {},
    on: {},
    emit: {},
    ...over,
  };
}

function documentValue(): Document {
  const text = node(TEXT, ROOT + "." + PAGE + "." + TEXT, "text", 10, {
    settings: { text: "甲" },
  });
  const page = node(PAGE, ROOT + "." + PAGE, "column", 10, { layout: [text] });
  return {
    schema: "dendro.tree/1",
    version: 1,
    root: node(ROOT, ROOT, "app", 0, { layout: [page] }),
    pages: [{ id: PAGE, title: "灵感", route: "/ideas" }],
    active: PAGE,
    data: {},
  };
}

const MANIFEST = {
  default: "ideas",
  pages: [{ name: "ideas", title: "灵感", route: "/ideas", file: "tree/pages/ideas.json" }],
};

function stubFetch(
  handler: (url: string) => { ok: boolean; status: number; body?: unknown },
): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      const result = handler(String(input));
      return {
        ok: result.ok,
        status: result.status,
        json: async () => result.body,
      } as Response;
    }),
  );
}

function container(): HTMLElement {
  const el = document.createElement("div");
  document.body.append(el);
  return el;
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("V1 产物预览", () => {
  it("读 manifest + 页面文档，挂出 DOM", async () => {
    stubFetch((url) =>
      url.includes("manifest.json")
        ? { ok: true, status: 200, body: MANIFEST }
        : { ok: true, status: 200, body: documentValue() },
    );
    const el = container();

    const handle = await mountTreePreview(el);

    expect(el.querySelector('[data-type="app"]')).not.toBeNull();
    expect(el.textContent).toContain("甲");
    handle.dispose();
    expect(el.children.length).toBe(0);
  });

  it("重复 mount 先撤旧的，不叠 DOM", async () => {
    stubFetch((url) =>
      url.includes("manifest.json")
        ? { ok: true, status: 200, body: MANIFEST }
        : { ok: true, status: 200, body: documentValue() },
    );
    const el = container();

    await mountTreePreview(el);
    await mountTreePreview(el);

    expect(el.querySelectorAll('[data-type="app"]').length).toBe(1);
  });

  it("manifest 没取到：reject 带状态码", async () => {
    stubFetch(() => ({ ok: false, status: 404 }));

    await expect(mountTreePreview(container())).rejects.toThrow(/返回 404/);
  });

  it("页面不在 manifest 里：reject 说清名字", async () => {
    stubFetch(() => ({ ok: true, status: 200, body: MANIFEST }));

    await expect(mountTreePreview(container(), { page: "nope" })).rejects.toThrow(/没有页面/);
  });

  it("manifest 形状不对：reject", async () => {
    stubFetch(() => ({ ok: true, status: 200, body: { pages: [] } }));

    await expect(mountTreePreview(container())).rejects.toThrow(/default/);
  });
});

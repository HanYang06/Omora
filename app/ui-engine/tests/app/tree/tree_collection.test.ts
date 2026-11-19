// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { Document, Node } from "../../../src/contract/tree_generated";
import type { RenderContext } from "../../../src/renderer/types";
import { mountTreeDocument } from "../../../src/app/tree/tree_renderer";

const ROOT = "aaaaaaaaaaaaaaaa";
const PAGE = "bbbbbbbbbbbbbbbb";
const FEED = "cccccccccccccccc";
const TEMPLATE = "dddddddddddddddd";

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

function feedNode(): Node {
  return node(FEED, ROOT + "." + PAGE + "." + FEED, "column", 10, {
    collection: {
      source: "ideas.feed",
      key: "id",
      select: "template",
      templates: {
        item: node(TEMPLATE, ROOT + "." + PAGE + "." + FEED + "." + TEMPLATE, "text", 10, {
          settings: { text: "占位" },
          bind: { text: "item.title" },
        }),
      },
    },
  });
}

function docOf(items: Record<string, unknown>[], version = 1): Document {
  return {
    schema: "dendro.tree/1",
    version,
    root: node(ROOT, ROOT, "app", 0, {
      layout: [node(PAGE, ROOT + "." + PAGE, "column", 10, { layout: [feedNode()] })],
    }),
    pages: [{ id: PAGE, title: "灵感", route: "/ideas" }],
    active: PAGE,
    data: { "ideas.feed": { revision: version, items } },
  };
}

function context(): RenderContext {
  return {
    event: () => undefined,
    loadMedia: () => Promise.reject(new Error("测试不加载媒体")),
    cleanup: () => undefined,
  };
}

function mount(documentValue: Document): {
  container: HTMLElement;
  runtime: ReturnType<typeof mountTreeDocument>;
} {
  const container = document.createElement("div");
  document.body.append(container);
  const runtime = mountTreeDocument(container, documentValue, context());
  return { container, runtime };
}

function texts(container: HTMLElement): string[] {
  return [...container.querySelectorAll<HTMLElement>('[data-type="text"]')].map(
    (el) => el.textContent ?? "",
  );
}

describe("V1 collection 挂载期实例化", () => {
  it("按 items 展开模板，bind 解析进 props", () => {
    const { container, runtime } = mount(
      docOf([
        { id: "a", template: "item", title: "甲" },
        { id: "b", template: "item", title: "乙" },
      ]),
    );

    expect(texts(container)).toEqual(["甲", "乙"]);
    runtime.dispose();
    container.remove();
  });

  it("replace 按 key 复用实例：同 key 保留元素，新 key 挂载，旧 key 卸载", () => {
    const first = mount(
      docOf([
        { id: "a", template: "item", title: "甲" },
        { id: "b", template: "item", title: "乙" },
      ]),
    );
    const before = first.container.querySelectorAll<HTMLElement>('[data-type="text"]');
    const elementA = before[0];
    const elementB = before[1];

    const replaced = first.runtime.replace(
      docOf(
        [
          { id: "a", template: "item", title: "甲改" },
          { id: "c", template: "item", title: "丙" },
        ],
        2,
      ),
    );

    expect(replaced.ok).toBe(true);
    const after = first.container.querySelectorAll<HTMLElement>('[data-type="text"]');
    expect(after[0]).toBe(elementA);
    expect(after[0]?.textContent).toBe("甲改");
    expect(after[1]?.textContent).toBe("丙");
    expect([...after].includes(elementB as HTMLElement)).toBe(false);

    first.runtime.dispose();
    first.container.remove();
  });

  it("坏条目只丢自己并记 E-TEMPLATE / E-ID-DUPLICATE", () => {
    const { container, runtime } = mount(
      docOf([
        { id: "a", template: "item", title: "甲" },
        { template: "item", title: "缺 key" },
        { id: "b", template: "不存在", title: "坏模板" },
        { id: "a", template: "item", title: "重复" },
        { id: "c", template: "item", title: "丙" },
      ]),
    );

    expect(texts(container)).toEqual(["甲", "丙"]);
    const codes = runtime.diagnostics.map((diagnostic) => diagnostic.code);
    expect(codes).toContain("E-TEMPLATE");
    expect(codes).toContain("E-ID-DUPLICATE");

    runtime.dispose();
    container.remove();
  });

  it("没有 data 时 collection 不产生条目", () => {
    const documentValue = docOf([]);
    documentValue.data = {};
    const { container, runtime } = mount(documentValue);

    expect(texts(container)).toEqual([]);
    expect(runtime.diagnostics).toEqual([]);

    runtime.dispose();
    container.remove();
  });
});

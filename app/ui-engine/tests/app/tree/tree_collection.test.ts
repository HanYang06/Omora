// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { Document, Node } from "../../../src/contract/tree_generated";
import type { Kind, RenderContext } from "../../../src/renderer/types";
import { treeKinds } from "../../../src/components/tree_kinds";
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

  it("data op 按 key 增量 reconcile：同 key 复用、新 key 挂载、旧 key 卸载、顺序跟随数据", () => {
    const { container, runtime } = mount(
      docOf([
        { id: "a", template: "item", title: "甲" },
        { id: "b", template: "item", title: "乙" },
      ]),
    );
    const before = [...container.querySelectorAll<HTMLElement>('[data-type="text"]')];
    const elementA = before[0];
    const elementB = before[1];

    const result = runtime.applyOps({
      kind: "ops",
      document: 2,
      base: 1,
      seq: 1,
      ops: [
        {
          op: "data",
          source: "ideas.feed",
          revision: 2,
          items: [
            { id: "b", template: "item", title: "乙改" },
            { id: "c", template: "item", title: "丙" },
          ],
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.ok ? result.changed : []).toEqual([]);
    const after = [...container.querySelectorAll<HTMLElement>('[data-type="text"]')];
    expect(after.map((el) => el.textContent)).toEqual(["乙改", "丙"]);
    expect(after[0]).toBe(elementB);
    expect(after.includes(elementA as HTMLElement)).toBe(false);

    runtime.dispose();
    container.remove();
  });

  it("data op 只换顺序时移动已有元素，不重建", () => {
    const { container, runtime } = mount(
      docOf([
        { id: "a", template: "item", title: "甲" },
        { id: "b", template: "item", title: "乙" },
      ]),
    );
    const [elementA, elementB] = [...container.querySelectorAll<HTMLElement>('[data-type="text"]')];

    const result = runtime.applyOps({
      kind: "ops",
      document: 2,
      base: 1,
      seq: 2,
      ops: [
        {
          op: "data",
          source: "ideas.feed",
          revision: 2,
          items: [
            { id: "b", template: "item", title: "乙" },
            { id: "a", template: "item", title: "甲" },
          ],
        },
      ],
    });

    expect(result.ok).toBe(true);
    const after = [...container.querySelectorAll<HTMLElement>('[data-type="text"]')];
    expect(after.map((el) => el.textContent)).toEqual(["乙", "甲"]);
    expect(after[0]).toBe(elementB);
    expect(after[1]).toBe(elementA);

    runtime.dispose();
    container.remove();
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

  it("virtual collection 把 items 投影给 kind，data op 触发 update", () => {
    const seen: unknown[] = [];
    const probe: Kind = {
      create(node) {
        const el = document.createElement("div");
        el.dataset.type = "probe";
        seen.push(node.props.items);
        el.textContent = String((node.props.items as unknown[]).length);
        return el;
      },
      update(el, node) {
        seen.push(node.props.items);
        el.textContent = String((node.props.items as unknown[]).length);
      },
      childrenHosts: () => null,
    };
    const documentValue: Document = {
      schema: "dendro.tree/1",
      version: 1,
      root: node(ROOT, ROOT, "app", 0, {
        layout: [
          node(PAGE, ROOT + "." + PAGE, "column", 10, {
            layout: [
              node(FEED, ROOT + "." + PAGE + "." + FEED, "probe", 10, {
                collection: { source: "virtual.items", key: "id", virtual: true },
              }),
            ],
          }),
        ],
      }),
      pages: [{ id: PAGE, title: "灵感", route: "/ideas" }],
      active: PAGE,
      data: {
        "virtual.items": {
          revision: 1,
          items: [
            { id: "a", title: "甲" },
            { id: "b", title: "乙" },
          ],
        },
      },
    };
    const container = document.createElement("div");
    document.body.append(container);
    const runtime = mountTreeDocument(container, documentValue, context(), {
      ...treeKinds,
      probe,
    });

    const el = container.querySelector<HTMLElement>('[data-type="probe"]');
    expect(el?.textContent).toBe("2");
    expect((seen[0] as unknown[]).length).toBe(2);

    const result = runtime.applyOps({
      kind: "ops",
      document: 2,
      base: 1,
      seq: 1,
      ops: [
        {
          op: "data",
          source: "virtual.items",
          revision: 2,
          items: [
            { id: "a", title: "甲" },
            { id: "b", title: "乙" },
            { id: "c", title: "丙" },
          ],
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(el?.textContent).toBe("3");
    expect((seen.at(-1) as unknown[]).length).toBe(3);

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

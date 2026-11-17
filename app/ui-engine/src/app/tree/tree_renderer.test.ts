// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { Document, Node, Placement } from "../../contract/tree_generated";
import type { RenderContext } from "../../renderer/types";
import { mountTreeDocument } from "./tree_renderer";

const ROOT = "aaaaaaaaaaaaaaaa";
const PAGE = "bbbbbbbbbbbbbbbb";
const TEXT = "cccccccccccccccc";
const BUTTON = "dddddddddddddddd";

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

function pageChain(): string {
  return ROOT + "." + PAGE;
}

function docOf(children: Node[], slot?: Placement): Document {
  const page = node(PAGE, pageChain(), "column", 10, {
    layout: children,
    ...(slot === undefined ? {} : { slot }),
  });
  return {
    schema: "dendro.tree/1",
    version: 1,
    root: node(ROOT, ROOT, "app", 0, { layout: [page], title: "root" }),
    pages: [{ id: PAGE, title: "灵感", route: "/ideas" }],
    active: PAGE,
    data: {},
  };
}

function textNode(text: string): Node {
  return node(TEXT, pageChain() + "." + TEXT, "text", 10, { settings: { text } });
}

function context(events: string[] = []): RenderContext {
  return {
    event: (handler) => events.push(handler),
    loadMedia: () => Promise.reject(new Error("测试不加载媒体")),
    cleanup: () => undefined,
  };
}

function mount(
  documentValue: Document,
  events: string[] = [],
): {
  container: HTMLElement;
  runtime: ReturnType<typeof mountTreeDocument>;
} {
  const container = document.createElement("div");
  document.body.append(container);
  const runtime = mountTreeDocument(container, documentValue, context(events));
  return { container, runtime };
}

describe("V1 DOM 适配器", () => {
  it("按树挂出 DOM：app → column → text", () => {
    const { container, runtime } = mount(docOf([textNode("甲")]));

    expect(container.querySelector('[data-type="app"]')).not.toBeNull();
    expect(container.querySelector('[data-type="column"]')).not.toBeNull();
    expect(container.querySelector('[data-type="text"]')?.textContent).toBe("甲");
    expect(runtime.mounted).toBe(true);

    runtime.dispose();
    container.remove();
  });

  it("未知 kind 直接失败，不留半棵树", () => {
    const container = document.createElement("div");
    const unknown = node(TEXT, pageChain() + "." + TEXT, "mystery", 10);

    expect(() => mountTreeDocument(container, docOf([unknown]), context())).toThrow(/E-TREE-KIND/);
    expect(container.children.length).toBe(0);
  });

  it("placement 落到元素上：size.width → width，align → align-self", () => {
    const { container, runtime } = mount(
      docOf([textNode("甲")], { size: { width: 56 }, align: "center" }),
    );

    const page = container.querySelector<HTMLElement>('[data-type="column"]');
    expect(page?.style.width).toBe("56px");
    expect(page?.style.alignSelf).toBe("center");

    runtime.dispose();
    container.remove();
  });

  it("on.click 变成 handler id，点击回传 ctx.event", () => {
    const events: string[] = [];
    const button = node(BUTTON, pageChain() + "." + BUTTON, "button", 10, {
      settings: { text: "按一下" },
      on: { click: "h1" },
    });
    const { container, runtime } = mount(docOf([button]), events);

    const el = container.querySelector<HTMLElement>('[data-type="button"]');
    expect(el?.dataset.handler).toBe("h1");
    el?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(events).toEqual(["h1"]);
    runtime.dispose();
    container.remove();
  });

  it("replace 同 id / 同父的节点复用元素，只改内容", () => {
    const { container, runtime } = mount(docOf([textNode("甲")]));
    const before = container.querySelector<HTMLElement>('[data-type="text"]');

    const replaced = runtime.replace(docOf([textNode("乙")]));

    expect(replaced.ok).toBe(true);
    const after = container.querySelector<HTMLElement>('[data-type="text"]');
    expect(after).toBe(before);
    expect(after?.textContent).toBe("乙");

    runtime.dispose();
    container.remove();
  });

  it("unmount 把整棵树从容器里摘掉", () => {
    const { container, runtime } = mount(docOf([textNode("甲")]));

    runtime.unmount();

    expect(container.children.length).toBe(0);
    expect(runtime.mounted).toBe(false);
    container.remove();
  });
});

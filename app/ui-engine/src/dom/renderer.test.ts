// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { Node } from "../core/types";
import { registry } from "../components/registry";
import { DomRenderer } from "./renderer";
import { mount } from "./testing";
import type { Kind } from "./types";

function text(value: string, id?: string): Node {
  return id === undefined
    ? { type: "text", props: { text: value }, children: [] }
    : { type: "text", props: { text: value }, children: [], id };
}

function column(children: Node[], id?: string): Node {
  return id === undefined
    ? { type: "column", props: {}, children }
    : { type: "column", props: {}, children, id };
}

describe("DomRenderer", () => {
  it("挂载 column / text", () => {
    const mounted = mount(column([text("甲"), text("乙")]));

    expect(mounted.root.querySelector(".omora-column")).not.toBeNull();
    expect(mounted.root.textContent).toBe("甲乙");
    mounted.destroy();
  });

  it("同一个 id 的 text 原地更新", () => {
    const mounted = mount(column([text("甲", "a")]));
    const before = mounted.root.querySelector('[data-type="text"]');

    mounted.render(column([text("乙", "a")]));

    const after = mounted.root.querySelector('[data-type="text"]');
    expect(after).toBe(before);
    expect(after?.textContent).toBe("乙");
    mounted.destroy();
  });

  it("同 id / 同 type 不会重建元素", () => {
    const mounted = mount(column([text("甲", "a"), text("乙", "b")]));
    const before = mounted.root.querySelectorAll('[data-type="text"]');

    mounted.render(column([text("甲", "a"), text("乙", "b")]));

    const after = mounted.root.querySelectorAll('[data-type="text"]');
    expect(after[0]).toBe(before[0]);
    expect(after[1]).toBe(before[1]);
    mounted.destroy();
  });

  it("按 id 重排时复用元素", () => {
    const a = text("甲", "a");
    const b = text("乙", "b");
    const mounted = mount(column([a, b]));
    const before = mounted.root.querySelectorAll('[data-type="text"]');

    mounted.render(column([b, a]));

    const after = mounted.root.querySelectorAll('[data-type="text"]');
    expect(after[0]).toBe(before[1]);
    expect(after[1]).toBe(before[0]);
    mounted.destroy();
  });

  it("type 变了就换元素；未知 type 画占位", () => {
    const mounted = mount(column([text("甲", "n")]));
    const unknown: Node = { type: "nope", props: {}, children: [], id: "n" };

    mounted.render(column([unknown]));

    expect(mounted.root.querySelector('[data-type="text"]')).toBeNull();
    expect(mounted.root.querySelector('[data-unknown-type="nope"]')).not.toBeNull();
    mounted.destroy();
  });

  it("childrenHosts 可以按子节点下标分配挂载点", () => {
    const splitKind: Kind = {
      create() {
        const el = document.createElement("div");
        el.className = "test-split";
        const side = document.createElement("div");
        side.className = "side";
        const main = document.createElement("div");
        main.className = "main";
        el.append(side, main);
        return el;
      },
      childrenHosts(el) {
        return [el.querySelector(".side"), el.querySelector(".main")];
      },
    };
    const container = document.createElement("div");
    document.body.append(container);
    const renderer = new DomRenderer({
      registry: { ...registry, splitTest: splitKind },
      context: {
        event: () => undefined,
        loadMedia: () => Promise.resolve({ mime: "", data: "" }),
        cleanup: () => undefined,
      },
    });
    const node: Node = {
      type: "splitTest",
      props: {},
      children: [text("侧", "a"), text("主", "b")],
    };

    renderer.render(node, container);

    expect(container.querySelector(".side")?.textContent).toBe("侧");
    expect(container.querySelector(".main")?.textContent).toBe("主");

    renderer.dispose();
    container.remove();
  });

  it("卸载会移除元素", () => {
    const mounted = mount(column([text("甲")]));

    mounted.destroy();

    expect(mounted.root.querySelector(".omora-column")).toBeNull();
  });
});

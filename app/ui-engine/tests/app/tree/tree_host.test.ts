// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { Node } from "../../../src/contract/tree_generated";
import type { TreeChildHandle } from "../../../src/engine/tree/types";
import { DomTreeHost } from "../../../src/app/tree/tree_host";

function node(id: string): Node {
  return {
    id,
    chain: id.repeat(1),
    kind: "text",
    order: 0,
    layout: [],
    settings: {},
    bind: {},
    on: {},
    emit: {},
  };
}

function child(id: string, text: string): TreeChildHandle {
  const el = document.createElement("span");
  el.textContent = text;
  el.dataset.id = id;
  return { node: node(id), output: el };
}

function elementOf(handle: TreeChildHandle): HTMLElement {
  return handle.output as HTMLElement;
}

function idsIn(host: HTMLElement): string[] {
  return [...host.children].map((el) => (el as HTMLElement).dataset.id ?? "?");
}

describe("DomTreeHost", () => {
  it("mount 按 index 排在同宿主里", () => {
    const host = document.createElement("div");
    const treeHost = new DomTreeHost([host]);
    const first = child("1111111111111111", "一");
    const second = child("2222222222222222", "二");

    treeHost.mount(second, 1);
    treeHost.mount(first, 0);

    expect(idsIn(host)).toEqual(["1111111111111111", "2222222222222222"]);
  });

  it("update 改 index 时重排，不重建元素", () => {
    const host = document.createElement("div");
    const treeHost = new DomTreeHost([host]);
    const first = child("1111111111111111", "一");
    const second = child("2222222222222222", "二");
    treeHost.mount(first, 0);
    treeHost.mount(second, 1);
    const firstEl = elementOf(first);

    treeHost.update(first, 1);
    treeHost.update(second, 0);

    expect(idsIn(host)).toEqual(["2222222222222222", "1111111111111111"]);
    expect(elementOf(first)).toBe(firstEl);
  });

  it("unmount 只摘自己的元素", () => {
    const host = document.createElement("div");
    host.append(document.createElement("p"));
    const treeHost = new DomTreeHost([host]);
    const only = child("1111111111111111", "一");
    treeHost.mount(only, 0);

    treeHost.unmount(only);

    expect(host.querySelector("span")).toBeNull();
    expect(host.querySelector("p")).not.toBeNull();
  });

  it("index 越界回退到最后一个挂载点", () => {
    const first = document.createElement("div");
    const second = document.createElement("div");
    const treeHost = new DomTreeHost([first, second]);
    const far = child("1111111111111111", "一");

    treeHost.mount(far, 9);

    expect(second.children.length).toBe(1);
    expect(first.children.length).toBe(0);
  });

  it("replaceHosts 只允许末尾追加；换掉旧挂载点直接抛", () => {
    const first = document.createElement("div");
    const second = document.createElement("div");
    const treeHost = new DomTreeHost([first]);

    treeHost.replaceHosts([first, second]);
    expect(() => treeHost.replaceHosts([document.createElement("div")])).toThrow(/不能更换/);
  });
});

// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { RenderContext } from "../renderer/types";
import { knownTreeKinds, treeKindNames, treeKinds } from "./tree_kinds";

function context(): RenderContext {
  return {
    event: () => undefined,
    loadMedia: () => Promise.reject(new Error("测试不加载媒体")),
    cleanup: () => undefined,
  };
}

describe("V1 kind 词表", () => {
  it("包含结构根、导航与常用组件", () => {
    for (const name of ["app", "page-link", "column", "row", "text", "card", "search", "list"]) {
      expect(treeKinds[name], name).toBeDefined();
    }
  });

  it("名单与集合一致，排序稳定，且不含未知 kind", () => {
    const names = treeKindNames();

    expect(names).toEqual([...names].sort());
    expect([...knownTreeKinds()]).toEqual(names);
    expect(knownTreeKinds().has("mystery")).toBe(false);
  });

  it("app 根是横向容器，子节点挂自己", () => {
    const kind = treeKinds["app"];
    if (kind === undefined) {
      throw new Error("缺少 app kind");
    }

    const el = kind.create({ type: "app", props: {}, children: [] }, context());

    expect(el.className).toBe("omora-row");
    expect(el.dataset.type).toBe("app");
    expect(el.dataset.dendroLayout).toBe("slot");
    expect("childrenHosts" in kind).toBe(false);
  });
});

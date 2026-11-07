import { describe, expect, it } from "vitest";

import { resolveItems, resolveText } from "../src/renderer/binding";

describe("binding resolution", () => {
  it("reads a nested path from the slot scope", () => {
    expect(resolveText("$item.title", { item: { title: "标题" } })).toBe("标题");
  });

  it("treats strings without the $ prefix as literals", () => {
    expect(resolveText("item.title", { item: { title: "标题" } })).toBe("item.title");
  });

  it("renders nothing for a missing binding instead of crashing", () => {
    expect(resolveText("$missing.path", {})).toBe("");
  });

  it("returns an empty list when the binding is not an array", () => {
    expect(resolveItems("$items", { items: "not-an-array" })).toEqual([]);
  });
});

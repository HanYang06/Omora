import { describe, expect, it } from "vitest";
import type { PageEntry, Snapshot } from "../types";
import { bootSnapshot, isStale, pagesMatch } from "./boot";

function snapshot(page: string): Snapshot {
  return {
    pages: [{ name: page, label: page }],
    page,
    meta: "",
    content: { type: "column", props: {}, children: [] },
    version: 1,
  };
}

describe("bootSnapshot", () => {
  it("按顺序取第一份能用的", () => {
    const snapshots = { ideas: snapshot("ideas") };
    expect(bootSnapshot(snapshots, ["projects", "ideas"])?.page).toBe("ideas");
  });

  it("一份都没有就是 null", () => {
    expect(bootSnapshot({}, [])).toBeNull();
  });
});

describe("pagesMatch", () => {
  const ideas: PageEntry = { name: "ideas", label: "灵感" };
  const projects: PageEntry = { name: "projects", label: "项目" };
  const pages: PageEntry[] = [ideas, projects];

  it("同一版返回真", () => {
    expect(pagesMatch(pages, [...pages])).toBe(true);
  });

  it("少一页、改标签、换顺序都算不同版", () => {
    expect(pagesMatch(pages, [ideas])).toBe(false);
    expect(pagesMatch(pages, [{ name: "ideas", label: "想法" }, projects])).toBe(false);
    expect(pagesMatch(pages, [projects, ideas])).toBe(false);
  });

  it("isStale 是取反", () => {
    expect(isStale(pages, pages)).toBe(false);
    expect(isStale(pages, [])).toBe(true);
  });
});

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseView } from "./view";

/** 跨语言 fixture（Python `serialize_view` 必须产出同一份；见 app/sdk/tests/test_view.py）。 */
const VIEW_FIXTURE_PATH = fileURLToPath(
  new URL("../../../sdk/tests/fixtures/view.json", import.meta.url),
);

function fixture(): Record<string, unknown> {
  const value: unknown = JSON.parse(readFileSync(VIEW_FIXTURE_PATH, "utf8"));
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("fixture 必须是对象");
  }
  return value as Record<string, unknown>;
}

function parsed(value: unknown) {
  const result = parseView(value);
  if (!result.ok) {
    throw new Error("view 应通过校验: " + JSON.stringify(result.diagnostics));
  }
  return result.view;
}

function codes(value: unknown): string[] {
  const result = parseView(value);
  if (result.ok) {
    throw new Error("view 应校验失败");
  }
  return result.diagnostics.map((diagnostic) => diagnostic.code);
}

function broken(patch: (value: Record<string, unknown>) => void): Record<string, unknown> {
  const value = structuredClone(fixture());
  patch(value);
  return value;
}

describe("parseView：主会话视图信封", () => {
  it("共享 fixture：版本 / 页面侧表 / 局部树 / active 全部读出", () => {
    const view = parsed(fixture());

    expect(view.kind).toBe("view");
    expect(view.schema).toBe("dendro.ui/1");
    expect(view.version).toBe(1);
    expect(view.active).toBe("page.ideas");
    expect(view.pages.map((page) => page.id)).toEqual(["page.ideas", "page.projects"]);
    expect(view.pages[0]?.icon).toBe("ideas");
    expect(view.localTrees.kind).toBe("local-trees");
    expect(view.localTrees.trees.map((tree) => tree.owner)).toEqual(["ui", "ideas"]);
    expect(view.data).toEqual({});
  });

  it("kind / schema 不对：E-PAYLOAD 并指出字段", () => {
    expect(codes(broken((value) => (value.kind = "snapshot")))).toContain("E-PAYLOAD");
    expect(codes(broken((value) => (value.schema = "dendro.ui/2")))).toContain("E-PAYLOAD");
  });

  it("version 必须是 >= 1 的整数", () => {
    for (const version of [0, -1, 1.5, "1", true]) {
      expect(codes(broken((value) => (value.version = version)))).toEqual(["E-PAYLOAD"]);
    }
  });

  it("local-trees 非法：诊断透传（trees 不是数组）", () => {
    const value = broken((draft) => {
      (draft.localTrees as Record<string, unknown>).trees = "nope";
    });

    expect(codes(value)).toContain("E-PAYLOAD");
  });

  it("页面侧表：重复 id / 缺字段 / 非数组都拒绝", () => {
    expect(
      codes(
        broken((value) => {
          const pages = value.pages as Record<string, unknown>[];
          pages[1] = { ...pages[0] };
        }),
      ),
    ).toEqual(["E-ID-DUPLICATE"]);
    expect(
      codes(
        broken((value) => {
          const pages = value.pages as Record<string, unknown>[];
          delete pages[0]?.label;
        }),
      ),
    ).toContain("E-PAYLOAD");
    expect(codes(broken((value) => (value.pages = {})))).toEqual(["E-PAYLOAD"]);
  });

  it("active 不在 pages 里：E-TARGET-MISSING", () => {
    expect(codes(broken((value) => (value.active = "page.detail")))).toEqual(["E-TARGET-MISSING"]);
  });

  it("没有页面时 active 必须是空串", () => {
    const value = broken((draft) => {
      draft.pages = [];
      draft.active = "page.ideas";
    });

    expect(codes(value)).toEqual(["E-PAYLOAD"]);
    expect(parsed({ ...fixture(), pages: [], active: "" }).version).toBe(1);
  });

  it("data 必须是对象", () => {
    expect(codes(broken((value) => (value.data = [])))).toEqual(["E-PAYLOAD"]);
  });
});

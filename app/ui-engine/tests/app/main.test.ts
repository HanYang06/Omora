// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { engineMode } from "../../src/app/main";

describe("engineMode：默认入口只剩 V1 树", () => {
  it("空查询 / tree-live / 未知值都走 V1 树主会话", () => {
    expect(engineMode("")).toBe("tree-live");
    expect(engineMode("?engine=tree-live")).toBe("tree-live");
    expect(engineMode("?engine=slot")).toBe("tree-live");
    expect(engineMode("?engine=something")).toBe("tree-live");
  });

  it("内置预览：构建产物 tree、虚拟列表、原生 dialog", () => {
    expect(engineMode("?engine=tree")).toBe("tree");
    expect(engineMode("?engine=tree&page=ideas")).toBe("tree");
    expect(engineMode("?engine=virtual")).toBe("virtual");
    expect(engineMode("?engine=dialog")).toBe("dialog");
  });
});

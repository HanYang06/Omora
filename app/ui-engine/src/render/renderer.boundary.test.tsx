// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Node } from "../core/types";
import { components } from "./components";
import { renderTree } from "./renderer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function node(type: string, text = ""): Node {
  return { type, props: text.length > 0 ? { text } : {}, children: [] };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  delete components.boom;
  vi.restoreAllMocks();
});

describe("节点级错误边界", () => {
  it("一个组件抛异常只换掉它那一格，兄弟照常", async () => {
    components.boom = () => {
      throw new Error("boom");
    };
    await act(async () => {
      root.render(<>{renderTree([node("boom"), node("text", "正常")])}</>);
    });

    expect(container.textContent).toContain("这一块暂时显示不出来");
    expect(container.textContent).toContain("正常");
  });

  it("节点数据换了才重试一次", async () => {
    let shouldThrow = true;
    components.boom = () => {
      if (shouldThrow) {
        throw new Error("boom");
      }
      return <span>恢复了</span>;
    };

    await act(async () => {
      root.render(<>{renderTree([node("boom")])}</>);
    });
    expect(container.textContent).toContain("这一块暂时显示不出来");

    shouldThrow = false;
    await act(async () => {
      root.render(<>{renderTree([node("boom")])}</>);
    });
    expect(container.textContent).toContain("恢复了");
  });
});

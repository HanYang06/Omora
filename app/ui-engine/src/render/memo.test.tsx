// @vitest-environment jsdom
import { act, type ComponentType, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { components } from "./components";
import { applySnapshotUpdate } from "./patch";
import { renderTree } from "./renderer";
import type { NodeComponentProps } from "../core/shared";
import type { Node, Snapshot } from "../core/types";

// act 要显式声明这是"测试环境"，否则 React 会警告不测行为。
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function node(type: string, props: Record<string, unknown> = {}, children: Node[] = []): Node {
  return { type, props, children };
}

function tree(): Snapshot {
  return {
    pages: [{ name: "main", label: "首页" }],
    page: "main",
    meta: "",
    version: 1,
    content: node("column", {}, [node("text", { text: "甲" }), node("text", { text: "乙" })]),
  };
}

const realText = components["text"];
let painted: string[] = [];

/** 计数用的文字组件：画一次记一次，用来观测"谁被重画了"。 */
function PaintCountedText({ node: current }: NodeComponentProps): ReactNode {
  const text = typeof current.props.text === "string" ? current.props.text : "";
  painted.push(text);
  return <span data-probe={text}>{text}</span>;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  components.text = PaintCountedText as ComponentType<NodeComponentProps>;
  painted = [];
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  if (realText !== undefined) {
    components.text = realText;
  }
});

function paint(snapshot: Snapshot, onEvent: () => void): void {
  act(() => {
    root.render(<>{renderTree([snapshot.content], onEvent)}</>);
  });
}

describe("渲染端按节点引用 memo", () => {
  it("补丁只重画变了的那一支，没变的子树不重画", () => {
    const before = tree();
    const onEvent = () => {};
    paint(before, onEvent);
    expect(painted).toEqual(["甲", "乙"]);

    const result = applySnapshotUpdate(before, {
      page: "main",
      version: 2,
      base: 1,
      ops: [{ op: "set", path: ["content", "children", 1, "props", "text"], value: "乙改" }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    paint(result.snapshot, onEvent);

    expect(painted).toEqual(["甲", "乙", "乙改"]);
    expect(result.snapshot.content.children[0]).toBe(before.content.children[0]);
  });

  it("往后面加一条只画新的那一行，已有的行不重画", () => {
    const before = tree();
    const onEvent = () => {};
    paint(before, onEvent);

    const result = applySnapshotUpdate(before, {
      page: "main",
      version: 2,
      base: 1,
      ops: [
        {
          op: "insert",
          path: ["content", "children"],
          index: 2,
          value: node("text", { text: "新" }),
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    paint(result.snapshot, onEvent);

    expect(painted).toEqual(["甲", "乙", "新"]);
  });

  it("同一份快照再画一次，一个组件都不重画", () => {
    const before = tree();
    const onEvent = () => {};
    paint(before, onEvent);
    paint(before, onEvent);

    expect(painted).toEqual(["甲", "乙"]);
  });

  it("整份换成新节点（全量兜底）时全部重画", () => {
    const before = tree();
    const onEvent = () => {};
    paint(before, onEvent);

    const fresh: Snapshot = { ...before, version: 2, content: tree().content };
    paint(fresh, onEvent);

    expect(painted).toEqual(["甲", "乙", "甲", "乙"]);
  });

  it("回调换了就全部重画：不能拿旧闭包继续用", () => {
    const before = tree();
    paint(before, () => {});
    paint(before, () => {});

    expect(painted).toEqual(["甲", "乙", "甲", "乙"]);
  });
});

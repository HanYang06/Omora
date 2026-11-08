import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Button } from "./components";
import { renderTree } from "./renderer";
import type { Node } from "./types";

const tree: Node[] = [
  {
    type: "column",
    props: {},
    children: [
      { type: "text", props: { text: "收件箱", kind: "title" }, children: [] },
      {
        type: "row",
        props: {},
        children: [
          { type: "text", props: { text: "两条" }, children: [] },
          {
            type: "button",
            props: { text: "新建", on_click: "main:1:0" },
            children: [],
          },
        ],
      },
    ],
  },
];

afterEach(() => {
  vi.restoreAllMocks();
});

describe("renderTree", () => {
  it("把 column / row / text / button 画成真实 DOM", () => {
    const html = renderToString(<>{renderTree(tree)}</>);

    expect(html).toContain('data-type="column"');
    expect(html).toContain('data-type="row"');
    expect(html).toContain('data-type="text"');
    expect(html).toContain('data-type="button"');
    expect(html).toContain("收件箱");
    expect(html).toContain("两条");
    expect(html).toContain("新建");
    expect(html).toContain('data-kind="title"');
    expect(html).toContain("omora-text--title");
    expect(html).toContain('data-handler="main:1:0"');
  });

  it("未知 type 画占位框并 console.warn", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const nodes: Node[] = [
      {
        type: "column",
        props: {},
        children: [{ type: "chart", props: { series: [1, 2] }, children: [] }],
      },
    ];

    const html = renderToString(<>{renderTree(nodes)}</>);

    expect(html).toContain('data-unknown-type="chart"');
    expect(html).toContain("未知组件: chart");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("chart"));
  });

  it("button 把 props.on_click 作为 handler id 交给 onEvent", () => {
    const onEvent = vi.fn();
    const node: Node = {
      type: "button",
      props: { text: "新建", on_click: "main:1:0" },
      children: [],
    };

    const element = Button({ node, onEvent }) as unknown as ReactElement<{
      onClick: () => void;
    }>;
    element.props.onClick();

    expect(onEvent).toHaveBeenCalledWith("main:1:0");
  });
});

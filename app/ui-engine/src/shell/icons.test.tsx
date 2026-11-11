import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Icon, IconGlyph } from "./icons";

describe("IconGlyph", () => {
  it("节点自带路径就不查词表", () => {
    const html = renderToString(<IconGlyph name="chart" path="M2 2h16v16H2z" />);

    expect(html).toContain('d="M2 2h16v16H2z"');
    expect(html).toContain('data-icon="custom"');
    expect(html).toContain('data-known="true"');
  });

  it("没给路径时按名字查词表", () => {
    const html = renderToString(<IconGlyph name="ideas" />);

    expect(html).toContain('data-icon="ideas"');
    expect(html).toContain('data-known="true"');
  });

  it("名字不认识就画空位", () => {
    const html = renderToString(<IconGlyph name="nope" />);

    expect(html).toContain('data-known="false"');
    expect(html).toContain("stroke-dasharray");
  });

  it("空路径不覆盖词表", () => {
    const html = renderToString(<IconGlyph name="ideas" path="" />);

    expect(html).toContain('data-icon="ideas"');
  });
});

describe("Icon 节点", () => {
  it("把 path 原样交给 IconGlyph", () => {
    const html = renderToString(
      <Icon node={{ type: "icon", props: { name: "chart", path: "M1 1h4" }, children: [] }} />,
    );

    expect(html).toContain('d="M1 1h4"');
    expect(html).toContain('data-type="icon"');
  });
});

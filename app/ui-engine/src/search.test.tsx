import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { renderTree } from "./renderer";
import { Result, Search, Suggestion } from "./search";
import { highlightParts, keyAction, moveActive } from "./searchText";
import type { Node } from "./types";

function noop(): void {}

function childButton(element: ReactElement<{ children?: unknown }>): ReactElement<{ onClick: () => void }> {
  const children = Array.isArray(element.props.children)
    ? (element.props.children as unknown[])
    : [element.props.children];
  const button = children.find(
    (child) => (child as ReactElement | null)?.type === "button",
  );
  return button as ReactElement<{ onClick: () => void }>;
}

const suggestionA: Node = {
  type: "suggestion",
  props: { value: "买牛奶", title: "买牛奶", meta: "刚刚", highlight: "牛奶", on_pick: "ideas:2:2" },
  children: [],
};

const suggestionB: Node = {
  type: "suggestion",
  props: { value: "牛奶要冷的", title: "牛奶要冷的", highlight: "牛奶", on_pick: "ideas:2:3" },
  children: [],
};

const searchNode: Node = {
  type: "search",
  props: {
    placeholder: "搜索灵感…",
    value: "牛奶",
    on_query: "ideas:2:0",
    on_submit: "ideas:2:1",
  },
  children: [suggestionA, suggestionB],
};

const resultNode: Node = {
  type: "result",
  props: {
    title: "买牛奶",
    snippet: "…下班顺路买牛奶…",
    meta: "刚刚 · 语音",
    highlight: "牛奶",
    on_click: "ideas:2:4",
  },
  children: [],
};

describe("highlightParts", () => {
  it("把查询的每次出现切出来，其余原样", () => {
    expect(highlightParts("买牛奶，牛奶要冷的", "牛奶")).toEqual([
      { text: "买", hit: false },
      { text: "牛奶", hit: true },
      { text: "，", hit: false },
      { text: "牛奶", hit: true },
      { text: "要冷的", hit: false },
    ]);
  });

  it("大小写不敏感，并保留原文的大小写", () => {
    expect(highlightParts("Milk Run", "milk")).toEqual([
      { text: "Milk", hit: true },
      { text: " Run", hit: false },
    ]);
  });

  it("没有查询词就整段不标，空文字不给段", () => {
    expect(highlightParts("买牛奶", undefined)).toEqual([{ text: "买牛奶", hit: false }]);
    expect(highlightParts("", "牛奶")).toEqual([]);
  });
});

describe("moveActive", () => {
  it("从输入框往下走到第一条，到底就停", () => {
    expect(moveActive(-1, 1, 3)).toBe(0);
    expect(moveActive(2, 1, 3)).toBe(2);
  });

  it("往上回到输入框，再往上还是输入框", () => {
    expect(moveActive(0, -1, 3)).toBe(-1);
    expect(moveActive(-1, -1, 3)).toBe(-1);
  });

  it("没有建议就没有选中项", () => {
    expect(moveActive(0, 1, 0)).toBe(-1);
  });
});

describe("keyAction", () => {
  it("回车在没有选中建议时提交输入框里的字", () => {
    expect(keyAction("Enter", { open: true, active: -1, count: 2, text: " 牛奶 " })).toEqual({
      kind: "submit",
    });
  });

  it("回车在选中建议时取那一条", () => {
    expect(keyAction("Enter", { open: true, active: 1, count: 2, text: "牛奶" })).toEqual({
      kind: "pick",
      active: 1,
    });
  });

  it("上下键只在有建议时动", () => {
    expect(keyAction("ArrowDown", { open: true, active: -1, count: 2, text: "牛" })).toEqual({
      kind: "move",
      active: 0,
    });
    expect(keyAction("ArrowDown", { open: false, active: -1, count: 0, text: "牛" })).toEqual({
      kind: "none",
    });
  });

  it("Escape 只关下拉，不提交", () => {
    expect(keyAction("Escape", { open: true, active: 0, count: 2, text: "牛" })).toEqual({
      kind: "close",
    });
    expect(keyAction("Escape", { open: false, active: -1, count: 0, text: "牛" })).toEqual({
      kind: "none",
    });
  });

  it("空输入回车不提交", () => {
    expect(keyAction("Enter", { open: false, active: -1, count: 0, text: "   " })).toEqual({
      kind: "none",
    });
  });
});

describe("Search", () => {
  it("画出搜索框、搜索按钮和下拉建议，命中的词标出来", () => {
    const html = renderToString(<>{renderTree([searchNode], noop)}</>);

    expect(html).toContain('data-type="search"');
    expect(html).toContain('placeholder="搜索灵感…"');
    expect(html).toContain('value="牛奶"');
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('data-icon="search"');
    expect(html).toContain("搜索");
    expect(html).toContain('data-type="suggestion"');
    expect(html).toContain("<span>买</span><mark>牛奶</mark>");
    expect(html).toContain("<mark>牛奶</mark><span>要冷的</span>");
    expect(html).toContain("刚刚");
    expect(html).toContain('data-handler="ideas:2:2"');
  });

  it("没有建议就不画下拉", () => {
    const bare: Node = {
      type: "search",
      props: { placeholder: "搜索灵感…", value: "" },
      children: [],
    };

    const html = renderToString(<>{renderTree([bare], noop)}</>);

    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("omora-search-list");
  });
});

describe("Suggestion", () => {
  it("点一条建议就把它要提交的查询交回去", () => {
    const onEvent = vi.fn();

    const element = Suggestion({ node: suggestionA, onEvent }) as unknown as ReactElement<{
      onClick: () => void;
    }>;
    element.props.onClick();

    expect(onEvent).toHaveBeenCalledWith("ideas:2:2", { value: "买牛奶" });
  });

  it("没有 on_pick 时点了不发事件", () => {
    const onEvent = vi.fn();
    const bare: Node = { type: "suggestion", props: { value: "买牛奶", title: "买牛奶" }, children: [] };

    const element = Suggestion({ node: bare, onEvent }) as unknown as ReactElement<{
      onClick: () => void;
    }>;
    element.props.onClick();

    expect(onEvent).not.toHaveBeenCalled();
  });
});

describe("Result", () => {
  it("画出标题、命中的 snippet 和时间 / 媒体", () => {
    const html = renderToString(<>{renderTree([resultNode], noop)}</>);

    expect(html).toContain('data-type="result"');
    expect(html).toContain("买牛奶");
    expect(html).toContain("<mark>牛奶</mark>");
    expect(html).toContain("刚刚 · 语音");
    expect(html).toContain('data-handler="ideas:2:4"');
  });

  it("点标题把空载荷交给 on_click", () => {
    const onEvent = vi.fn();

    const element = Result({ node: resultNode, onEvent }) as unknown as ReactElement<{
      children?: unknown;
    }>;
    childButton(element).props.onClick();

    expect(onEvent).toHaveBeenCalledWith("ideas:2:4", {});
  });
});

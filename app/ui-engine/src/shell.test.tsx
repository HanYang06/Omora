import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { NavItem, Shell } from "./shell";
import type { MediaData, Snapshot } from "./types";

const snapshot: Snapshot = {
  pages: [
    { name: "ideas", label: "灵感", count: 2 },
    { name: "projects", label: "项目" },
  ],
  page: "ideas",
  meta: "2 条",
  content: {
    type: "column",
    props: {},
    children: [
      { type: "recorder", props: { on_submit: "ideas:1:0" }, children: [] },
      {
        type: "input",
        props: { placeholder: "记一条灵感…", on_submit: "ideas:1:1" },
        children: [],
      },
      {
        type: "list",
        props: {},
        children: [
          {
            type: "item",
            props: { meta: "刚刚", title: "语音 0:03" },
            children: [
              { type: "audio", props: { media: "abc" }, children: [] },
              {
                type: "button",
                props: { text: "归档", on_click: "ideas:1:2", variant: "ghost" },
                children: [],
              },
            ],
          },
        ],
      },
    ],
  },
};

function noop(): void {}

async function loadMedia(_media: string): Promise<MediaData> {
  return { mime: "audio/webm", data: "" };
}

describe("Shell", () => {
  it("画出导航、当前页、捕获控件和连接状态", () => {
    const html = renderToString(
      <Shell
        snapshot={snapshot}
        status="open"
        endpoint="ws://127.0.0.1:8765"
        onNavigate={noop}
        onEvent={noop}
        loadMedia={loadMedia}
      />,
    );

    expect(html).toContain("灵感");
    expect(html).toContain("项目");
    expect(html).toContain('aria-current="page"');
    expect(html).toContain("2 条");
    expect(html).toContain("语音 0:03");
    expect(html).toContain("录音");
    expect(html).toContain('aria-label="播放"');
    expect(html).toContain("已连接");
    expect(html).toContain('data-status="open"');
  });

  it("没有快照时只剩壳，状态照写", () => {
    const html = renderToString(
      <Shell
        snapshot={null}
        status="connecting"
        endpoint="ws://127.0.0.1:8765"
        onNavigate={noop}
        onEvent={noop}
        loadMedia={loadMedia}
      />,
    );

    expect(html).toContain("连接中…");
    expect(html).not.toContain("omora-nav-item");
    expect(html).not.toContain("omora-page-inner");
  });

  it("断线时状态写清楚", () => {
    const html = renderToString(
      <Shell
        snapshot={null}
        status="closed"
        endpoint="ws://127.0.0.1:8765"
        onNavigate={noop}
        onEvent={noop}
        loadMedia={loadMedia}
      />,
    );

    expect(html).toContain("连接已断开");
  });

  it("NavItem 点击把页面名字交出去", () => {
    const onNavigate = vi.fn();
    const element = NavItem({
      entry: { name: "ideas", label: "灵感", count: 2 },
      active: true,
      onNavigate,
    }) as unknown as ReactElement<{ onClick: () => void }>;

    element.props.onClick();

    expect(onNavigate).toHaveBeenCalledWith("ideas");
  });
});

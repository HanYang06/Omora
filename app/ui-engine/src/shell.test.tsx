import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { RailButton, Shell } from "./shell";
import type { MediaData, Snapshot } from "./types";

const snapshot: Snapshot = {
  pages: [
    { name: "ideas", label: "灵感", icon: "ideas", count: 2 },
    { name: "projects", label: "项目" },
  ],
  page: "ideas",
  meta: "2 条",
  content: {
    type: "column",
    props: {},
    children: [
      { type: "text", props: { text: "还没有灵感。" }, children: [] },
      {
        type: "button",
        props: { text: "记一条", on_click: "ideas:1:0" },
        children: [],
      },
    ],
  },
};

function noop(): void {}

async function loadMedia(_media: string): Promise<MediaData> {
  return { mime: "audio/webm", data: "" };
}

describe("Shell", () => {
  it("左边是图标栏：每页一个图标按钮，当前页标出来，底部是连接圆点", () => {
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

    expect(html).toContain('data-connection="open"');
    expect(html).toContain("omora-shell-rail");
    expect(html).toContain('aria-label="灵感"');
    expect(html).toContain('aria-label="项目"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('data-icon="ideas"');
    // 页面没给 icon 就用 dot
    expect(html).toContain('data-icon="dot"');
    expect(html).not.toContain("omora-nav-item");
    expect(html).not.toContain("omora-sidebar");
  });

  it("主区只铺内容：不再有 720px 居中的页头", () => {
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

    expect(html).toContain("omora-page-inner");
    expect(html).toContain("还没有灵感。");
    expect(html).toContain("记一条");
    expect(html).not.toContain("omora-page-head");
    expect(html).not.toContain("omora-page-title");
  });

  it("底部圆点写清连接状态", () => {
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

    expect(html).toContain("omora-conn-dot");
    expect(html).toContain('data-status="open"');
    expect(html).toContain("已连接");
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

    expect(html).toContain("omora-shell-rail");
    expect(html).toContain("连接中…");
    expect(html).not.toContain("omora-shell-item");
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
    expect(html).toContain('data-status="closed"');
  });

  it("RailButton 点击把页面名字交出去", () => {
    const onNavigate = vi.fn();
    const element = RailButton({
      entry: { name: "ideas", label: "灵感", icon: "ideas", count: 2 },
      active: true,
      onNavigate,
    }) as unknown as ReactElement<{ onClick: () => void }>;

    element.props.onClick();

    expect(onNavigate).toHaveBeenCalledWith("ideas");
  });

  it("RailButton 没有 icon 时画 dot，label 只进 aria-label", () => {
    const element = RailButton({
      entry: { name: "projects", label: "项目" },
      active: false,
      onNavigate: noop,
    }) as unknown as ReactElement<{
      "data-icon": string;
      "aria-label": string;
      "aria-current"?: string;
    }>;

    expect(element.props["data-icon"]).toBe("dot");
    expect(element.props["aria-label"]).toBe("项目");
    expect(element.props["aria-current"]).toBeUndefined();
  });
});

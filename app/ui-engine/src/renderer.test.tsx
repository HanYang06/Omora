import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Audio } from "./capture";
import { Button, Input } from "./components";
import { renderTree } from "./renderer";
import type { MediaData, Node } from "./types";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("renderTree", () => {
  it("把 column / row / text / button 画成真实 DOM", () => {
    const tree: Node[] = [
      {
        type: "column",
        props: {},
        children: [
          { type: "text", props: { text: "灵感", kind: "title" }, children: [] },
          {
            type: "row",
            props: {},
            children: [
              { type: "text", props: { text: "两条" }, children: [] },
              { type: "button", props: { text: "新建", on_click: "ideas:1:0" }, children: [] },
            ],
          },
        ],
      },
    ];

    const html = renderToString(<>{renderTree(tree)}</>);

    expect(html).toContain('data-type="column"');
    expect(html).toContain('data-type="row"');
    expect(html).toContain('data-type="text"');
    expect(html).toContain('data-type="button"');
    expect(html).toContain("灵感");
    expect(html).toContain("两条");
    expect(html).toContain("新建");
    expect(html).toContain('data-kind="title"');
    expect(html).toContain("omora-text--title");
    expect(html).toContain('data-handler="ideas:1:0"');
  });

  it("list / item 画出账本行：左栏 meta、标题、动作", () => {
    const tree: Node[] = [
      {
        type: "list",
        props: {},
        children: [
          {
            type: "item",
            props: { meta: "昨天", title: "买牛奶" },
            children: [
              {
                type: "button",
                props: { text: "归档", on_click: "ideas:1:1", variant: "ghost" },
                children: [],
              },
            ],
          },
        ],
      },
    ];

    const html = renderToString(<>{renderTree(tree)}</>);

    expect(html).toContain('data-type="list"');
    expect(html).toContain('data-type="item"');
    expect(html).toContain("昨天");
    expect(html).toContain("买牛奶");
    expect(html).toContain("归档");
    expect(html).toContain("omora-button--ghost");
  });

  it("recorder / audio 画出捕获与播放控件", () => {
    const tree: Node[] = [
      { type: "recorder", props: { on_submit: "ideas:1:0" }, children: [] },
      { type: "audio", props: { media: "abc" }, children: [] },
    ];

    const html = renderToString(<>{renderTree(tree)}</>);

    expect(html).toContain('data-type="recorder"');
    expect(html).toContain("录音");
    expect(html).toContain('data-type="audio"');
    expect(html).toContain('aria-label="播放"');
    expect(html).toContain('data-handler="abc"');
  });

  it("empty 画出空状态；没有 hint 就不画第二行", () => {
    const withHint: Node[] = [
      { type: "empty", props: { title: "还没有灵感。", hint: "在上面写第一条。" }, children: [] },
    ];
    const withoutHint: Node[] = [
      { type: "empty", props: { title: "还没有项目。" }, children: [] },
    ];

    const html = renderToString(<>{renderTree(withHint)}</>);
    const bare = renderToString(<>{renderTree(withoutHint)}</>);

    expect(html).toContain("还没有灵感。");
    expect(html).toContain("在上面写第一条。");
    expect(html).toContain("omora-empty-hint");
    expect(bare).toContain("还没有项目。");
    expect(bare).not.toContain("omora-empty-hint");
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

  it("button 把 handler id 交给 onEvent", () => {
    const onEvent = vi.fn();
    const node: Node = {
      type: "button",
      props: { text: "新建", on_click: "ideas:1:0" },
      children: [],
    };

    const element = Button({ node, onEvent }) as unknown as ReactElement<{
      onClick: () => void;
    }>;
    element.props.onClick();

    expect(onEvent).toHaveBeenCalledWith("ideas:1:0", {});
  });

  it("input 回车把值交给 onEvent 并清空自己", () => {
    const onEvent = vi.fn();
    const node: Node = {
      type: "input",
      props: { placeholder: "记一条灵感…", on_submit: "ideas:1:0" },
      children: [],
    };

    const element = Input({ node, onEvent }) as unknown as ReactElement<{
      children: ReactElement[];
    }>;
    const input = element.props.children.find((child) => child.type === "input") as
      | ReactElement<{
          onKeyDown: (event: { key: string; currentTarget: { value: string } }) => void;
        }>
      | undefined;
    expect(input).toBeDefined();
    if (input === undefined) {
      return;
    }

    const event = { key: "Enter", currentTarget: { value: "  买牛奶 " } };
    input.props.onKeyDown(event);

    expect(onEvent).toHaveBeenCalledWith("ideas:1:0", { value: "买牛奶" });
    expect(event.currentTarget.value).toBe("");
  });

  it("input 用 value 预填，用户不动它就带着旧名字", () => {
    const node: Node = {
      type: "input",
      props: { value: "语音 11-11 03:41", on_submit: "ideas:1:0" },
      children: [],
    };

    const html = renderToString(<Input node={node} onEvent={() => {}} />);

    expect(html).toContain('value="语音 11-11 03:41"');
  });

  it("audio 点击把 media id 交给 loadMedia", () => {
    const loadMedia = vi.fn(
      (_media: string): Promise<MediaData> => new Promise(() => {}),
    );
    const node: Node = { type: "audio", props: { media: "abc" }, children: [] };

    const element = Audio({ node, loadMedia }) as unknown as ReactElement<{
      onClick: () => void;
    }>;
    element.props.onClick();

    expect(loadMedia).toHaveBeenCalledWith("abc");
  });
});
describe("音频 / 视频捕捉节点", () => {
  it("没有设备接口时，音频与视频都禁用并写清原因", () => {
    const tree: Node[] = [
      {
        type: "audio_capture",
        props: { on_submit: "ideas:1:0", quality: "high", noise_reduction: true, max_seconds: 600 },
        children: [],
      },
      {
        type: "video_capture",
        props: {
          on_submit: "ideas:1:1",
          upload_url: "http://127.0.0.1:8766/media",
          quality: "720p",
          max_seconds: 120,
        },
        children: [],
      },
    ];

    const html = renderToString(<>{renderTree(tree)}</>);

    expect(html).toContain('data-type="audio_capture"');
    expect(html).toContain("录音");
    expect(html).toContain('data-type="video_capture"');
    expect(html).toContain("录视频");
    expect(html).toContain('data-gate="off"');
    expect(html).toContain("不支持媒体设备采集");
    expect(html).toContain("disabled");
  });

  it("video 有 src 就画播放器，没有就说明通道没起", () => {
    const withSrc: Node[] = [
      {
        type: "video",
        props: { media: "abc", src: "http://127.0.0.1:8766/media/abc" },
        children: [],
      },
    ];
    const withoutSrc: Node[] = [{ type: "video", props: { media: "abc" }, children: [] }];

    const played = renderToString(<>{renderTree(withSrc)}</>);
    const missing = renderToString(<>{renderTree(withoutSrc)}</>);

    expect(played).toContain('src="http://127.0.0.1:8766/media/abc"');
    expect(played).toContain('data-media="abc"');
    expect(missing).toContain("媒体通道未就绪");
  });
});

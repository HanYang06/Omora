import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Item } from "./components";
import { Card } from "./cards";
import { renderTree } from "./renderer";
import { Chip, Tile } from "./tiles";
import type { MediaData, Node } from "../core/types";

function noop(): void {}

async function loadMedia(_media: string): Promise<MediaData> {
  return { mime: "audio/webm", data: "" };
}

function htmlOf(nodes: Node[]): string {
  return renderToString(<>{renderTree(nodes, noop, loadMedia)}</>);
}

interface ClickableElement {
  props: {
    className?: string;
    children?: unknown;
    disabled?: boolean;
    role?: string;
    tabIndex?: number;
    onClick?: (event?: { stopPropagation: () => void }) => void;
    onKeyDown?: (event: { key: string; preventDefault: () => void }) => void;
    "aria-pressed"?: boolean;
    "data-handler"?: string;
  };
}

function asElement(value: unknown): ClickableElement {
  return value as ClickableElement;
}

function findChild(element: ClickableElement, className: string): ClickableElement | undefined {
  const children = Array.isArray(element.props.children)
    ? element.props.children
    : [element.props.children];
  return children
    .filter((child): child is ReactElement => typeof child === "object" && child !== null)
    .map((child) => asElement(child))
    .find((child) => child.props?.className === className);
}

describe("split / rail", () => {
  it("split 先摆侧栏再摆主区，两块都在", () => {
    const html = htmlOf([
      {
        type: "split",
        props: {},
        children: [
          { type: "text", props: { text: "索引" }, children: [] },
          { type: "text", props: { text: "主区" }, children: [] },
        ],
      },
    ]);

    expect(html).toContain('data-type="split"');
    expect(html).toContain('data-slot="side"');
    expect(html).toContain('data-slot="main"');
    expect(html.indexOf("索引")).toBeLessThan(html.indexOf("主区"));
  });

  it("rail 画标题和一串条目", () => {
    const html = htmlOf([
      {
        type: "rail",
        props: { title: "全部灵感" },
        children: [
          {
            type: "item",
            props: { meta: "刚刚", title: "买牛奶", on_click: "ideas:4:0" },
            children: [],
          },
        ],
      },
    ]);

    expect(html).toContain('data-type="rail"');
    expect(html).toContain("全部灵感");
    expect(html).toContain("买牛奶");
    expect(html).toContain("omora-rail-list");
    expect(html).toContain("omora-item-link");
  });
});

describe("icon", () => {
  it("认识的名字画 20px 描边 SVG，颜色跟文字走", () => {
    const html = htmlOf([{ type: "icon", props: { name: "mic" }, children: [] }]);

    expect(html).toContain('data-type="icon"');
    expect(html).toContain('width="20"');
    expect(html).toContain('height="20"');
    expect(html).toContain('fill="none"');
    expect(html).toContain('stroke="currentColor"');
    expect(html).toContain('data-icon="mic"');
    expect(html).toContain('data-known="true"');
    expect(html).toContain("<path");
  });

  it("不认识的名字画空位，不猜近似图标", () => {
    const html = htmlOf([{ type: "icon", props: { name: "nope" }, children: [] }]);

    expect(html).toContain('data-icon="nope"');
    expect(html).toContain('data-known="false"');
    expect(html).toContain("stroke-dasharray");
    expect(html).not.toContain("<path");
  });
});

describe("tile", () => {
  const tile: Node = {
    type: "tile",
    props: { icon: "mic", title: "录音", on_click: "ideas:5:0" },
    children: [],
  };

  it("只画图标和标题，handler 落在按钮上", () => {
    const html = htmlOf([tile]);

    expect(html).toContain('data-type="tile"');
    expect(html).toContain('data-icon="mic"');
    expect(html).toContain("录音");
    expect(html).toContain('data-handler="ideas:5:0"');
    expect(html).not.toContain("omora-tile-hint");
  });

  it("旧快照里带着 hint 也不画", () => {
    const html = htmlOf([
      {
        type: "tile",
        props: { icon: "mic", title: "录音", hint: "说出口，比打字快", on_click: "ideas:5:0" },
        children: [],
      },
    ]);

    expect(html).toContain("录音");
    expect(html).not.toContain("说出口，比打字快");
  });

  it("点一下把空载荷交给 on_click", () => {
    const onEvent = vi.fn();
    const element = asElement(Tile({ node: tile, onEvent }));

    element.props.onClick?.();

    expect(onEvent).toHaveBeenCalledWith("ideas:5:0", {});
  });

  it("没有 on_click 就禁用，点了也不发事件", () => {
    const onEvent = vi.fn();
    const bare: Node = { type: "tile", props: { icon: "mic", title: "录音" }, children: [] };
    const element = asElement(Tile({ node: bare, onEvent }));

    expect(element.props.disabled).toBe(true);
    element.props.onClick?.();

    expect(onEvent).not.toHaveBeenCalled();
  });
});

describe("chip", () => {
  const active: Node = {
    type: "chip",
    props: { text: "置顶", active: true, on_click: "ideas:5:1" },
    children: [],
  };
  const idle: Node = {
    type: "chip",
    props: { text: "全部", active: false, on_click: "ideas:5:2" },
    children: [],
  };

  it("active 只是样子：样式类和 aria-pressed 一起变", () => {
    const on = htmlOf([active]);
    const off = htmlOf([idle]);

    expect(on).toContain("omora-chip is-active");
    expect(on).toContain('aria-pressed="true"');
    expect(off).not.toContain("is-active");
    expect(off).toContain('aria-pressed="false"');
  });

  it("点 chip 把 handler 交回去", () => {
    const onEvent = vi.fn();
    const element = asElement(Chip({ node: active, onEvent }));

    element.props.onClick?.();

    expect(onEvent).toHaveBeenCalledWith("ideas:5:1", {});
  });
});

describe("card", () => {
  const card: Node = {
    type: "card",
    props: { title: "买牛奶", text: "下班顺路", meta: "刚刚 · 语音", on_click: "ideas:5:3" },
    children: [{ type: "audio", props: { media: "abc" }, children: [] }],
  };

  it("画标题、正文、时间和可选媒体", () => {
    const html = htmlOf([card]);

    expect(html).toContain('data-type="card"');
    expect(html).toContain("买牛奶");
    expect(html).toContain("下班顺路");
    expect(html).toContain("刚刚 · 语音");
    expect(html).toContain('data-handler="ideas:5:3"');
    expect(html).toContain('data-type="audio"');
    expect(html).toContain("omora-card-media");
  });

  it("点整张卡片进 detail", () => {
    const onEvent = vi.fn();
    const element = asElement(Card({ node: card, onEvent }));

    element.props.onClick?.();

    expect(onEvent).toHaveBeenCalledWith("ideas:5:3", {});
  });

  it("键盘 Enter 也能进 detail", () => {
    const onEvent = vi.fn();
    const preventDefault = vi.fn();
    const element = asElement(Card({ node: card, onEvent }));

    element.props.onKeyDown?.({ key: "Enter", preventDefault });

    expect(preventDefault).toHaveBeenCalled();
    expect(onEvent).toHaveBeenCalledWith("ideas:5:3", {});
  });

  it("点媒体不触发整张卡片", () => {
    const onEvent = vi.fn();
    const element = asElement(
      Card({ node: card, onEvent, children: <span key="media">媒体</span> }),
    );
    const media = findChild(element, "omora-card-media");
    expect(media).toBeDefined();
    if (media === undefined) {
      return;
    }

    const stopPropagation = vi.fn();
    (media.props as { onClick?: (event: { stopPropagation: () => void }) => void }).onClick?.({
      stopPropagation,
    });

    expect(stopPropagation).toHaveBeenCalled();
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("没有 on_click 就只是静态卡片", () => {
    const onEvent = vi.fn();
    const bare: Node = { type: "card", props: { title: "买牛奶" }, children: [] };
    const element = asElement(Card({ node: bare, onEvent }));

    expect(element.props.role).toBeUndefined();
    expect(element.props.onClick).toBeUndefined();
    expect(element.props.tabIndex).toBeUndefined();
  });
});

describe("item 的可点标题", () => {
  const linked: Node = {
    type: "item",
    props: { meta: "刚刚", title: "买牛奶", on_click: "ideas:5:4" },
    children: [],
  };

  it("有 on_click 时标题是按钮，点它走事件且不冒泡到整行", () => {
    const onEvent = vi.fn();
    const element = asElement(Item({ node: linked, onEvent }));
    const main = findChild(element, "omora-item-main");
    expect(main).toBeDefined();
    if (main === undefined) {
      return;
    }
    const link = findChild(main, "omora-item-link");
    expect(link).toBeDefined();
    if (link === undefined) {
      return;
    }

    const stopPropagation = vi.fn();
    expect(link.props["data-handler"]).toBe("ideas:5:4");
    link.props.onClick?.({ stopPropagation });

    expect(stopPropagation).toHaveBeenCalled();
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith("ideas:5:4", {});
  });

  it("有 on_click 时整行也能点", () => {
    const onEvent = vi.fn();
    const element = asElement(Item({ node: linked, onEvent }));

    expect(element.props["data-handler"]).toBe("ideas:5:4");
    element.props.onClick?.();

    expect(onEvent).toHaveBeenCalledWith("ideas:5:4", {});
  });

  it("没有 on_click 时标题还是静态 span，整行不接点击", () => {
    const onEvent = vi.fn();
    const element = asElement(
      Item({
        node: { type: "item", props: { meta: "刚刚", title: "买牛奶" }, children: [] },
        onEvent,
      }),
    );
    const html = htmlOf([{ type: "item", props: { meta: "刚刚", title: "买牛奶" }, children: [] }]);

    expect(html).toContain("omora-item-title");
    expect(html).not.toContain("omora-item-link");
    expect(element.props.onClick).toBeUndefined();
    expect(element.props["data-handler"]).toBeUndefined();
  });
});

describe("panel", () => {
  it("先画工具条再画内容", () => {
    const html = htmlOf([
      {
        type: "panel",
        props: {},
        children: [
          {
            type: "row",
            props: {},
            children: [
              {
                type: "chip",
                props: { text: "全部", active: true, on_click: "ideas:6:2" },
                children: [],
              },
            ],
          },
          {
            type: "column",
            props: {},
            children: [
              {
                type: "card",
                props: { title: "买牛奶", meta: "刚刚", on_click: "ideas:6:3" },
                children: [],
              },
            ],
          },
        ],
      },
    ]);

    expect(html).toContain('data-type="panel"');
    expect(html).toContain("omora-panel");
    expect(html).toContain('data-type="row"');
    expect(html).toContain('data-type="chip"');
    expect(html).toContain('data-type="card"');
    expect(html.indexOf("全部")).toBeLessThan(html.indexOf("买牛奶"));
  });
});

describe("hotkey", () => {
  it("注册表认识它，但不画任何东西——它只挂键盘监听", () => {
    const html = htmlOf([
      {
        type: "hotkey",
        props: { key: "space", on_press: "ideas:7:0", on_release: "ideas:7:1" },
        children: [],
      },
    ]);

    expect(html).toBe("");
  });
});

describe("注册表", () => {
  it("新节点都从注册表画出来", () => {
    const html = htmlOf([
      {
        type: "split",
        props: {},
        children: [
          {
            type: "rail",
            props: { title: "全部灵感" },
            children: [
              {
                type: "item",
                props: { meta: "刚刚", title: "买牛奶", on_click: "ideas:6:0" },
                children: [],
              },
            ],
          },
          {
            type: "column",
            props: {},
            children: [
              {
                type: "tile",
                props: { icon: "mic", title: "录音", on_click: "ideas:6:1" },
                children: [],
              },
              {
                type: "panel",
                props: {},
                children: [
                  {
                    type: "row",
                    props: {},
                    children: [
                      {
                        type: "chip",
                        props: { text: "全部", active: true, on_click: "ideas:6:2" },
                        children: [],
                      },
                    ],
                  },
                  {
                    type: "column",
                    props: {},
                    children: [
                      {
                        type: "card",
                        props: {
                          title: "买牛奶",
                          text: "顺路",
                          meta: "刚刚",
                          on_click: "ideas:6:3",
                        },
                        children: [],
                      },
                    ],
                  },
                ],
              },
              { type: "icon", props: { name: "pin" }, children: [] },
            ],
          },
        ],
      },
    ]);

    expect(html).toContain('data-type="split"');
    expect(html).toContain('data-type="rail"');
    expect(html).toContain('data-type="item"');
    expect(html).toContain('data-type="tile"');
    expect(html).toContain('data-type="panel"');
    expect(html).toContain('data-type="chip"');
    expect(html).toContain('data-type="card"');
    expect(html).toContain('data-type="icon"');
    expect(html).not.toContain("omora-unknown");
  });

  it("spread 的行两头分开：标题在左、动作在右", () => {
    const spread = renderToString(
      <>
        {renderTree([
          {
            type: "row",
            props: { spread: true },
            children: [{ type: "text", props: { text: "录音" }, children: [] }],
          },
        ])}
      </>,
    );
    const plain = renderToString(
      <>
        {renderTree([
          {
            type: "row",
            props: {},
            children: [{ type: "text", props: { text: "录音" }, children: [] }],
          },
        ])}
      </>,
    );

    expect(spread).toContain("omora-row--spread");
    expect(plain).not.toContain("omora-row--spread");
  });
});

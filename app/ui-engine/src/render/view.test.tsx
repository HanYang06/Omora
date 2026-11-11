import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Contribution, Snapshot } from "../core/types";
import { renderTree } from "./renderer";
import { withContributions } from "./view";

const KEY = "ideas.home.after_capture";

function snapshot(contributions?: Contribution[]): Snapshot {
  return {
    pages: [{ name: "ideas", label: "灵感" }],
    page: "ideas",
    meta: "",
    content: {
      type: "column",
      props: {},
      children: [{ type: "slot", props: { key: KEY }, children: [] }],
    },
    version: 3,
    ...(contributions === undefined ? {} : { contributions }),
  };
}

const button: Contribution = {
  owner: "audio",
  target: KEY,
  op: "append",
  order: 10,
  tree: { type: "button", props: { text: "录音" }, children: [] },
};

describe("withContributions", () => {
  it("页面根带着 om.window.page，贡献可以整页替换", () => {
    const base: Snapshot = {
      ...snapshot(),
      content: {
        type: "column",
        props: { key: "om.window.page" },
        children: [],
      },
      contributions: [
        {
          owner: "audio",
          target: "om.window.page",
          op: "replace",
          tree: { type: "text", props: { text: "接管" }, children: [] },
        },
      ],
    };

    const view = withContributions(base);
    expect(view).not.toBeNull();
    if (view === null) {
      return;
    }
    expect(view.content).toEqual({
      type: "text",
      props: { text: "接管", key: "om.window.page" },
      children: [],
    });
  });

  it("没有贡献时原样返回同一份快照", () => {
    const base = snapshot();
    expect(withContributions(base)).toBe(base);
  });

  it("把贡献 append 进槽位，且不动原快照", () => {
    const base = snapshot([button]);
    const view = withContributions(base);

    expect(view).not.toBeNull();
    if (view === null) {
      return;
    }
    const slot = view.content.children[0];
    expect(slot).toBeDefined();
    if (slot === undefined) {
      return;
    }
    expect(slot.children).toEqual([{ type: "button", props: { text: "录音" }, children: [] }]);
    expect(base.content.children[0]?.children).toHaveLength(0);
  });

  it("槽位节点把挂进来的子树画出来", () => {
    const view = withContributions(snapshot([button]));
    expect(view).not.toBeNull();
    if (view === null) {
      return;
    }

    const html = renderToString(<>{renderTree([view.content])}</>);
    expect(html).toContain('data-type="slot"');
    expect(html).toContain("录音");
  });
});

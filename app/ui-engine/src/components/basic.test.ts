// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import type { Node } from "../renderer/types";
import { mount, type Mounted } from "./testing";

const mounted: Mounted[] = [];

afterEach(() => {
  for (const item of mounted.splice(0)) {
    item.destroy();
  }
});

/** 挂一棵树；测试结束统一销毁，免得 document 上留着 hotkey 监听。 */
function setup(node: Node): Mounted {
  const instance = mount(node);
  mounted.push(instance);
  return instance;
}

function makeNode(
  type: string,
  props: Record<string, unknown>,
  extra: Partial<Pick<Node, "id" | "events">> = {},
): Node {
  return { type, props, children: [], ...extra };
}

function present<T>(value: T | null, what: string): T {
  if (value === null) {
    throw new Error("测试里找不到 " + what);
  }
  return value;
}

function query<T extends Element>(root: ParentNode, selector: string): T {
  return present(root.querySelector<T>(selector), selector);
}

function keyboard(
  type: "keydown" | "keyup",
  target: EventTarget,
  code: string,
  key: string,
  repeat = false,
): KeyboardEvent {
  const event = new KeyboardEvent(type, { code, key, repeat, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

describe("text", () => {
  it("画 span：样式类、data-type / data-kind、文字", () => {
    const instance = setup(makeNode("text", { text: "全部灵感" }));
    const el = query<HTMLElement>(instance.root, '[data-type="text"]');

    expect(el.tagName).toBe("SPAN");
    expect(el.className).toBe("omora-text");
    expect(el.dataset.kind).toBe("body");
    expect(el.textContent).toBe("全部灵感");
  });

  it("title / muted 只映射样式类", () => {
    const title = setup(makeNode("text", { text: "灵感", kind: "title" }));
    const muted = setup(makeNode("text", { text: "两条", kind: "muted" }));

    expect(query(title.root, '[data-type="text"]').className).toBe("omora-text omora-text--title");
    expect(query(muted.root, '[data-type="text"]').className).toBe("omora-text omora-text--muted");
    expect(query(title.root, '[data-type="text"]').getAttribute("data-kind")).toBe("title");
  });

  it("update 原地改文字和 kind，不换元素", () => {
    const instance = setup(makeNode("text", { text: "甲", kind: "title" }, { id: "t" }));
    const before = query<HTMLElement>(instance.root, '[data-type="text"]');

    instance.render(makeNode("text", { text: "乙", kind: "muted" }, { id: "t" }));

    const after = query<HTMLElement>(instance.root, '[data-type="text"]');
    expect(after).toBe(before);
    expect(after.textContent).toBe("乙");
    expect(after.className).toBe("omora-text omora-text--muted");
    expect(after.dataset.kind).toBe("muted");
  });
});

describe("icon", () => {
  it("认识的名字画 20px 描边 SVG，颜色跟文字走", () => {
    const instance = setup(makeNode("icon", { name: "mic" }));
    const wrap = query<HTMLElement>(instance.root, ".omora-icon");
    const svg = query<SVGSVGElement>(wrap, "svg");

    expect(wrap.dataset.type).toBe("icon");
    expect(svg.getAttribute("class")).toBe("omora-icon-svg");
    expect(svg.getAttribute("width")).toBe("20");
    expect(svg.getAttribute("height")).toBe("20");
    expect(svg.getAttribute("viewBox")).toBe("0 0 20 20");
    expect(svg.getAttribute("fill")).toBe("none");
    expect(svg.getAttribute("stroke")).toBe("currentColor");
    expect(svg.getAttribute("stroke-width")).toBe("1.5");
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("data-icon")).toBe("mic");
    expect(svg.getAttribute("data-known")).toBe("true");
    expect(svg.querySelectorAll("path")).toHaveLength(2);
    expect(svg.querySelector("rect")).not.toBeNull();
  });

  it("不认识的名字画虚线空位，不猜近似图标", () => {
    const instance = setup(makeNode("icon", { name: "nope" }));
    const svg = query<SVGSVGElement>(instance.root, "svg");

    expect(svg.getAttribute("data-icon")).toBe("nope");
    expect(svg.getAttribute("data-known")).toBe("false");
    expect(svg.querySelector("path")).toBeNull();
    const hole = query<SVGRectElement>(svg, "rect");
    expect(hole.getAttribute("stroke-dasharray")).toBe("2 2.4");
  });

  it("节点自带 path 时优先画它", () => {
    const instance = setup(makeNode("icon", { name: "mic", path: "M10 2.8h4" }));
    const svg = query<SVGSVGElement>(instance.root, "svg");

    expect(svg.getAttribute("data-icon")).toBe("custom");
    expect(svg.getAttribute("data-known")).toBe("true");
    const path = query<SVGPathElement>(svg, "path");
    expect(path.getAttribute("d")).toBe("M10 2.8h4");
    expect(svg.querySelectorAll("*")).toHaveLength(1);
  });

  it("update 在同一个 span / svg 上换图标", () => {
    const instance = setup(makeNode("icon", { name: "mic" }, { id: "i" }));
    const wrap = query<HTMLElement>(instance.root, ".omora-icon");
    const svg = query<SVGSVGElement>(wrap, "svg");

    instance.render(makeNode("icon", { name: "pin" }, { id: "i" }));

    expect(query<HTMLElement>(instance.root, ".omora-icon")).toBe(wrap);
    expect(query<SVGSVGElement>(wrap, "svg")).toBe(svg);
    expect(svg.getAttribute("data-icon")).toBe("pin");
    expect(svg.querySelectorAll("path")).toHaveLength(3);

    instance.render(makeNode("icon", { name: "nope" }, { id: "i" }));
    expect(svg.getAttribute("data-known")).toBe("false");
    expect(svg.querySelector("path")).toBeNull();

    instance.render(makeNode("icon", { name: "mic", path: "M10 2.8h4" }, { id: "i" }));
    expect(svg.getAttribute("data-icon")).toBe("custom");
    expect(query<SVGPathElement>(svg, "path").getAttribute("d")).toBe("M10 2.8h4");
  });
});

describe("tile", () => {
  const tile = (props: Record<string, unknown>, extra?: Partial<Pick<Node, "id" | "events">>) =>
    makeNode("tile", props, extra);

  it("只画图标和标题，handler 落在按钮上", () => {
    const instance = setup(tile({ icon: "mic", title: "录音", on_click: "ideas:5:0" }));
    const button = query<HTMLButtonElement>(instance.root, "button.omora-tile");

    expect(button.dataset.type).toBe("tile");
    expect(button.getAttribute("type")).toBe("button");
    expect(button.dataset.handler).toBe("ideas:5:0");
    expect(button.disabled).toBe(false);
    expect(query<HTMLElement>(button, ".omora-tile-title").textContent).toBe("录音");
    expect(query<HTMLElement>(button, ".omora-tile-icon").getAttribute("aria-hidden")).toBe("true");
    expect(query<SVGSVGElement>(button, ".omora-tile-icon svg").getAttribute("data-icon")).toBe(
      "mic",
    );
  });

  it("点一下把空载荷交给 on_click", () => {
    const instance = setup(tile({ icon: "mic", title: "录音", on_click: "ideas:5:0" }));

    query<HTMLButtonElement>(instance.root, "button").click();

    expect(instance.events).toEqual([{ handler: "ideas:5:0", payload: {} }]);
  });

  it("node.events 优先于 props.on_click", () => {
    const instance = setup(
      tile({ icon: "mic", title: "录音", on_click: "old" }, { events: { click: "new" } }),
    );
    const button = query<HTMLButtonElement>(instance.root, "button");

    expect(button.dataset.handler).toBe("new");
    button.click();

    expect(instance.events).toEqual([{ handler: "new", payload: {} }]);
  });

  it("没有 on_click 就禁用，硬派 click 也不发事件", () => {
    const instance = setup(tile({ icon: "mic", title: "录音" }));
    const button = query<HTMLButtonElement>(instance.root, "button");

    expect(button.disabled).toBe(true);
    expect(button.hasAttribute("data-handler")).toBe(false);
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(instance.events).toHaveLength(0);
  });

  it("update 原地换标题 / handler / 图标，可点状态跟着变", () => {
    const instance = setup(tile({ icon: "mic", title: "录音", on_click: "a" }, { id: "t" }));
    const button = query<HTMLButtonElement>(instance.root, "button");
    const svg = query<SVGSVGElement>(button, "svg");

    instance.render(tile({ icon: "pin", title: "记一条", on_click: "b" }, { id: "t" }));

    expect(query<HTMLButtonElement>(instance.root, "button")).toBe(button);
    expect(button.dataset.handler).toBe("b");
    expect(query<HTMLElement>(button, ".omora-tile-title").textContent).toBe("记一条");
    expect(query<SVGSVGElement>(button, "svg")).toBe(svg);
    expect(svg.getAttribute("data-icon")).toBe("pin");

    instance.render(tile({ icon: "pin", title: "记一条" }, { id: "t" }));
    expect(button.disabled).toBe(true);
    expect(button.hasAttribute("data-handler")).toBe(false);
    button.click();
    expect(instance.events).toHaveLength(0);
  });

  it("旧快照里带着 hint 也不画", () => {
    const instance = setup(tile({ icon: "mic", title: "录音", hint: "说出口，比打字快" }));
    const button = query<HTMLButtonElement>(instance.root, "button");

    expect(query<HTMLElement>(button, ".omora-tile-title").textContent).toBe("录音");
    expect(instance.root.textContent).not.toContain("说出口，比打字快");
  });
});

describe("chip", () => {
  it("active 只是样子：样式类、data-active、aria-pressed 一起变", () => {
    const on = setup(makeNode("chip", { text: "置顶", active: true }));
    const off = setup(makeNode("chip", { text: "全部", active: false }));

    expect(query<HTMLButtonElement>(on.root, "button").className).toBe("omora-chip is-active");
    expect(query<HTMLButtonElement>(on.root, "button").dataset.active).toBe("true");
    expect(query<HTMLButtonElement>(on.root, "button").getAttribute("aria-pressed")).toBe("true");
    expect(query<HTMLButtonElement>(off.root, "button").className).toBe("omora-chip");
    expect(query<HTMLButtonElement>(off.root, "button").dataset.active).toBe("false");
    expect(query<HTMLButtonElement>(off.root, "button").getAttribute("aria-pressed")).toBe("false");
  });

  it("点 chip 把 handler 交回去", () => {
    const instance = setup(makeNode("chip", { text: "置顶", on_click: "ideas:5:1" }));
    const button = query<HTMLButtonElement>(instance.root, "button");

    button.click();

    expect(instance.events).toEqual([{ handler: "ideas:5:1", payload: {} }]);
  });

  it("没有 on_click 就禁用，硬派 click 也不发事件", () => {
    const instance = setup(makeNode("chip", { text: "全部" }));
    const button = query<HTMLButtonElement>(instance.root, "button");

    expect(button.disabled).toBe(true);
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(instance.events).toHaveLength(0);
  });

  it("update 原地换文字 / active / handler", () => {
    const instance = setup(
      makeNode("chip", { text: "全部", active: false, on_click: "a" }, { id: "c" }),
    );
    const button = query<HTMLButtonElement>(instance.root, "button");

    instance.render(makeNode("chip", { text: "置顶", active: true, on_click: "b" }, { id: "c" }));

    expect(query<HTMLButtonElement>(instance.root, "button")).toBe(button);
    expect(button.textContent).toBe("置顶");
    expect(button.className).toBe("omora-chip is-active");
    expect(button.dataset.active).toBe("true");
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(button.dataset.handler).toBe("b");
    button.click();
    expect(instance.events).toEqual([{ handler: "b", payload: {} }]);
  });
});

describe("hotkey", () => {
  const hotkey = (props: Record<string, unknown>, extra?: Partial<Pick<Node, "id" | "events">>) =>
    makeNode("hotkey", props, extra);

  it("只挂监听，不画内容：hidden、不占布局", () => {
    const instance = setup(hotkey({ key: "space", on_press: "press", on_release: "release" }));
    const el = query<HTMLElement>(instance.root, '[data-type="hotkey"]');

    expect(el.tagName).toBe("SPAN");
    expect(el.hidden).toBe(true);
    expect(el.getAttribute("aria-hidden")).toBe("true");
    expect(instance.root.textContent).toBe("");
  });

  it("按下发 on_press、松开发 on_release，并拦掉页面默认行为", () => {
    const instance = setup(hotkey({ key: "space", on_press: "press", on_release: "release" }));

    const down = keyboard("keydown", document.body, "Space", " ");
    keyboard("keyup", document.body, "Space", " ");

    expect(down.defaultPrevented).toBe(true);
    expect(instance.events).toEqual([
      { handler: "press", payload: {} },
      { handler: "release", payload: {} },
    ]);
  });

  it("压着不放只发一次按下", () => {
    const instance = setup(hotkey({ key: "space", on_press: "press" }));

    keyboard("keydown", document.body, "Space", " ");
    const repeat = keyboard("keydown", document.body, "Space", " ", true);
    keyboard("keyup", document.body, "Space", " ");

    expect(repeat.defaultPrevented).toBe(true);
    expect(instance.events).toEqual([{ handler: "press", payload: {} }]);
  });

  it("焦点在输入框里时不抢键，也不凭空发松开", () => {
    const instance = setup(hotkey({ key: "space", on_press: "press", on_release: "release" }));
    const input = document.createElement("input");
    instance.root.appendChild(input);

    const down = keyboard("keydown", input, "Space", " ");
    keyboard("keyup", input, "Space", " ");

    expect(down.defaultPrevented).toBe(false);
    expect(instance.events).toHaveLength(0);
  });

  it("按下后焦点跑进输入框，松手仍然要发松开", () => {
    const instance = setup(hotkey({ key: "space", on_press: "press", on_release: "release" }));
    const input = document.createElement("input");
    instance.root.appendChild(input);

    keyboard("keydown", document.body, "Space", " ");
    input.focus();
    keyboard("keyup", input, "Space", " ");

    expect(instance.events).toEqual([
      { handler: "press", payload: {} },
      { handler: "release", payload: {} },
    ]);
  });

  it("不是配置的键就不碰", () => {
    const instance = setup(hotkey({ key: "space", on_press: "press", on_release: "release" }));

    const down = keyboard("keydown", document.body, "KeyA", "a");
    keyboard("keyup", document.body, "KeyA", "a");

    expect(down.defaultPrevented).toBe(false);
    expect(instance.events).toHaveLength(0);
  });

  it("没按过就松手不发事件", () => {
    const instance = setup(hotkey({ key: "space", on_release: "release" }));

    keyboard("keyup", document.body, "Space", " ");

    expect(instance.events).toHaveLength(0);
  });

  it("没有 on_press 时按住仍然算数，松手照发 on_release", () => {
    const instance = setup(hotkey({ key: "space", on_release: "release" }));

    keyboard("keydown", document.body, "Space", " ");
    keyboard("keyup", document.body, "Space", " ");

    expect(instance.events).toEqual([{ handler: "release", payload: {} }]);
  });

  it("node.events 优先于 props.on_press / on_release", () => {
    const instance = setup(
      hotkey(
        { key: "space", on_press: "old.press", on_release: "old.release" },
        { events: { press: "new.press", release: "new.release" } },
      ),
    );

    keyboard("keydown", document.body, "Space", " ");
    keyboard("keyup", document.body, "Space", " ");

    expect(instance.events).toEqual([
      { handler: "new.press", payload: {} },
      { handler: "new.release", payload: {} },
    ]);
  });

  it("更新只换 handler id，监听不重复挂", () => {
    const instance = setup(hotkey({ key: "space", on_press: "a", on_release: "b" }, { id: "h" }));

    instance.render(hotkey({ key: "space", on_press: "c", on_release: "d" }, { id: "h" }));
    instance.render(hotkey({ key: "space", on_press: "e", on_release: "f" }, { id: "h" }));
    keyboard("keydown", document.body, "Space", " ");
    keyboard("keyup", document.body, "Space", " ");

    expect(instance.events).toEqual([
      { handler: "e", payload: {} },
      { handler: "f", payload: {} },
    ]);
  });

  it("卸载后撤掉 document 监听", () => {
    const instance = setup(hotkey({ key: "space", on_press: "press" }));

    instance.destroy();
    keyboard("keydown", document.body, "Space", " ");

    expect(instance.events).toHaveLength(0);
  });

  it("改 key 之后只认新的键", () => {
    const instance = setup(hotkey({ key: "space", on_press: "press" }, { id: "h" }));

    instance.render(hotkey({ key: "keyr", on_press: "press" }, { id: "h" }));
    keyboard("keydown", document.body, "Space", " ");
    keyboard("keydown", document.body, "KeyR", "r");

    expect(instance.events).toEqual([{ handler: "press", payload: {} }]);
  });
});

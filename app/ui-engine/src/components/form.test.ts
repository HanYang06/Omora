// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import type { Node } from "../renderer/types";
import { handlerOf } from "../renderer/events";
import { mount, type Mounted } from "./testing";

/** 表单输入类 kind：渲染标签/class、事件 id、更新与清理都在真实 DOM 上验。 */

function node(
  type: string,
  props: Record<string, unknown> = {},
  children: Node[] = [],
  id?: string,
): Node {
  const result: Node = { type, props, children };
  if (id !== undefined) {
    result.id = id;
  }
  return result;
}

/** 每个测试挂出去的树统一收尾，避免 DOM 泄漏。 */
const open: Mounted[] = [];

function render(root: Node): Mounted {
  const mounted = mount(root);
  open.push(mounted);
  return mounted;
}

afterEach(() => {
  for (const mounted of open.splice(0)) {
    mounted.destroy();
  }
});

function query<T extends Element = HTMLElement>(mounted: Mounted, selector: string): T {
  const el = mounted.root.querySelector<T>(selector);
  if (el === null) {
    throw new Error(`找不到 ${selector}`);
  }
  return el;
}

function click(el: Element): void {
  el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}

function change(el: Element): void {
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function keydown(
  el: Element,
  key: string,
  options: { ctrlKey?: boolean; metaKey?: boolean } = {},
): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ctrlKey: options.ctrlKey === true,
    metaKey: options.metaKey === true,
  });
  el.dispatchEvent(event);
  return event;
}

describe("button", () => {
  it("画成原生按钮：class / data-type / data-handler 都在", () => {
    const mounted = render(node("button", { text: "确定", on_click: "a:1:0" }));
    const button = query<HTMLButtonElement>(mounted, "button");

    expect(button.className).toBe("omora-button");
    expect(button.dataset.type).toBe("button");
    expect(button.dataset.handler).toBe("a:1:0");
    expect(button.type).toBe("button");
    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe("确定");
  });

  it("点一下把空载荷交给 handler", () => {
    const mounted = render(node("button", { text: "确定", on_click: "a:1:0" }));

    click(query(mounted, "button"));

    expect(mounted.events).toEqual([{ handler: "a:1:0", payload: {} }]);
  });

  it("没有 handler 就禁用、不画 data-handler，点了也不发事件", () => {
    const mounted = render(node("button", { text: "确定" }));
    const button = query<HTMLButtonElement>(mounted, "button");

    expect(button.disabled).toBe(true);
    expect(button.hasAttribute("data-handler")).toBe(false);
    click(button);
    expect(mounted.events).toEqual([]);
  });

  it("ghost variant 只影响样子", () => {
    const mounted = render(node("button", { text: "取消", variant: "ghost", on_click: "a:1:1" }));

    expect(query(mounted, "button").className).toBe("omora-button omora-button--ghost");
  });

  it("update 原地换文字与 handler，不换元素", () => {
    const mounted = render(node("button", { text: "甲", on_click: "a:1:0" }, [], "b"));
    const before = query<HTMLButtonElement>(mounted, "button");

    mounted.render(node("button", { text: "乙", on_click: "a:1:1" }, [], "b"));

    const after = query<HTMLButtonElement>(mounted, "button");
    expect(after).toBe(before);
    expect(after.textContent).toBe("乙");
    expect(after.dataset.handler).toBe("a:1:1");
  });

  it("node.events 优先于 props.on_click（legacy 事件入口）", () => {
    const source: Node = {
      type: "button",
      props: { text: "走", on_click: "old:1" },
      children: [],
      events: { click: "new:1" },
    };
    expect(handlerOf(source, "click")).toBe("new:1");
    const mounted = render(source);

    click(query(mounted, "button"));

    expect(mounted.events).toEqual([{ handler: "new:1", payload: {} }]);
  });

  it("卸载后监听撤销，旧元素再点不发事件", () => {
    const mounted = render(node("button", { text: "确定", on_click: "a:1:0" }, [], "b"));
    const button = query<HTMLButtonElement>(mounted, "button");

    mounted.destroy();
    click(button);

    expect(mounted.events).toEqual([]);
    expect(button.isConnected).toBe(false);
  });
});

describe("input", () => {
  it("画成一行输入：+ / 回车提示只在没有预填时出现", () => {
    const mounted = render(node("input", { placeholder: "记一笔", on_submit: "a:2:0" }));
    const wrapper = query(mounted, ".omora-capture");
    const field = query<HTMLInputElement>(mounted, "input.omora-capture-input");

    expect(wrapper.dataset.type).toBe("input");
    expect(field.placeholder).toBe("记一笔");
    expect(field.value).toBe("");
    expect(wrapper.querySelector(".omora-capture-plus")?.textContent).toBe("+");
    expect(wrapper.querySelector(".omora-capture-hint")?.textContent).toBe("回车");
  });

  it("有 value 就预填，不画 + / 回车", () => {
    const mounted = render(node("input", { value: "旧名字", on_submit: "a:2:0" }));

    expect(query<HTMLInputElement>(mounted, "input").value).toBe("旧名字");
    expect(mounted.root.querySelector(".omora-capture-plus")).toBeNull();
    expect(mounted.root.querySelector(".omora-capture-hint")).toBeNull();
  });

  it("回车把 trim 后的值交回去，然后清空自己", () => {
    const mounted = render(node("input", { placeholder: "记一笔", on_submit: "a:2:0" }));
    const field = query<HTMLInputElement>(mounted, "input");
    field.value = "  买牛奶  ";

    const event = keydown(field, "Enter");

    expect(event.defaultPrevented).toBe(false);
    expect(mounted.events).toEqual([{ handler: "a:2:0", payload: { value: "买牛奶" } }]);
    expect(field.value).toBe("");
  });

  it("回车空格子不提交，普通按键也不提交", () => {
    const mounted = render(node("input", { on_submit: "a:2:0" }));
    const field = query<HTMLInputElement>(mounted, "input");

    keydown(field, "Enter");
    field.value = "有字";
    keydown(field, "a");

    expect(mounted.events).toEqual([]);
  });

  it("update 时数据换了，聚焦中不覆盖用户草稿", () => {
    const mounted = render(node("input", { value: "旧", on_submit: "a:2:0" }, [], "i"));
    const field = query<HTMLInputElement>(mounted, "input");
    field.focus();
    field.value = "用户打的";

    mounted.render(node("input", { value: "新", on_submit: "a:2:0" }, [], "i"));

    expect(query(mounted, "input.omora-capture-input")).toBe(field);
    expect(field.value).toBe("用户打的");
  });

  it("没聚焦时数据变了就写进输入框", () => {
    const mounted = render(node("input", { value: "旧" }, [], "i"));
    const field = query<HTMLInputElement>(mounted, "input");

    mounted.render(node("input", { value: "新" }, [], "i"));

    expect(field.value).toBe("新");
  });

  it("清掉预填后 + / 回车提示回来", () => {
    const mounted = render(node("input", { value: "旧" }, [], "i"));

    mounted.render(node("input", {}, [], "i"));

    expect(mounted.root.querySelector(".omora-capture-plus")).not.toBeNull();
    expect(mounted.root.querySelector(".omora-capture-hint")).not.toBeNull();
    expect(query<HTMLInputElement>(mounted, "input").value).toBe("");
  });

  it("卸载后回车不再发事件", () => {
    const mounted = render(node("input", { on_submit: "a:2:0" }, [], "i"));
    const field = query<HTMLInputElement>(mounted, "input");

    mounted.destroy();
    field.value = "买牛奶";
    keydown(field, "Enter");

    expect(mounted.events).toEqual([]);
  });
});

describe("textarea", () => {
  it("画成多行输入：placeholder / rows / 预填都在", () => {
    const mounted = render(node("textarea", { placeholder: "备注", value: "旧的", rows: 5 }));
    const field = query<HTMLTextAreaElement>(mounted, "textarea.omora-textarea");

    expect(field.dataset.type).toBe("textarea");
    expect(field.placeholder).toBe("备注");
    expect(field.rows).toBe(5);
    expect(field.value).toBe("旧的");
  });

  it("rows 缺省 3", () => {
    const mounted = render(node("textarea", {}));

    expect(query<HTMLTextAreaElement>(mounted, "textarea").rows).toBe(3);
  });

  it("失焦把整段文字交回去", () => {
    const mounted = render(node("textarea", { on_submit: "a:7:0" }));
    const field = query<HTMLTextAreaElement>(mounted, "textarea");
    field.value = "第一行\n第二行";

    field.dispatchEvent(new Event("blur"));

    expect(mounted.events).toEqual([{ handler: "a:7:0", payload: { value: "第一行\n第二行" } }]);
  });

  it("普通回车只是换行，Ctrl + Enter 才提交", () => {
    const mounted = render(node("textarea", { on_submit: "a:7:0" }));
    const field = query<HTMLTextAreaElement>(mounted, "textarea");
    field.value = "第一行";

    const plain = keydown(field, "Enter");
    expect(plain.defaultPrevented).toBe(false);
    expect(mounted.events).toEqual([]);

    const submit = keydown(field, "Enter", { ctrlKey: true });
    expect(submit.defaultPrevented).toBe(true);
    expect(mounted.events).toEqual([{ handler: "a:7:0", payload: { value: "第一行" } }]);
  });

  it("update 时聚焦中不覆盖草稿", () => {
    const mounted = render(node("textarea", { value: "旧" }, [], "t"));
    const field = query<HTMLTextAreaElement>(mounted, "textarea");
    field.focus();
    field.value = "草稿";

    mounted.render(node("textarea", { value: "新" }, [], "t"));

    expect(query(mounted, "textarea")).toBe(field);
    expect(field.value).toBe("草稿");
  });

  it("没有 on_submit 时失焦不发事件", () => {
    const mounted = render(node("textarea", {}));
    const field = query<HTMLTextAreaElement>(mounted, "textarea");
    field.value = "随便写";

    field.dispatchEvent(new Event("blur"));

    expect(mounted.events).toEqual([]);
  });
});

describe("number_input", () => {
  it("画成数字输入：上下限与值都是原生属性", () => {
    const mounted = render(
      node("number_input", { value: 3, min: 1, max: 10, step: 1, on_change: "a:8:0" }),
    );
    const field = query<HTMLInputElement>(mounted, "input.omora-number");

    expect(field.dataset.type).toBe("number_input");
    expect(field.type).toBe("number");
    expect(field.value).toBe("3");
    expect(field.min).toBe("1");
    expect(field.max).toBe("10");
    expect(field.step).toBe("1");
  });

  it("把输入解析成数字回传", () => {
    const mounted = render(node("number_input", { value: 3, on_change: "a:8:0" }));
    const field = query<HTMLInputElement>(mounted, "input");

    field.value = "7";
    change(field);

    expect(mounted.events).toEqual([{ handler: "a:8:0", payload: { value: 7 } }]);
  });

  it("空值不回传", () => {
    const mounted = render(node("number_input", { on_change: "a:8:1" }));
    const field = query<HTMLInputElement>(mounted, "input");

    field.value = "";
    change(field);

    expect(mounted.events).toEqual([]);
  });

  it("update 原地改上下限", () => {
    const mounted = render(
      node("number_input", { value: 3, min: 1, max: 10, on_change: "a:8:0" }, [], "n"),
    );
    const field = query<HTMLInputElement>(mounted, "input");

    mounted.render(
      node("number_input", { value: 3, min: 0, max: 20, on_change: "a:8:0" }, [], "n"),
    );

    expect(query(mounted, "input")).toBe(field);
    expect(field.min).toBe("0");
    expect(field.max).toBe("20");
  });
});

describe("slider", () => {
  it("缺省 0–100，值从数据来", () => {
    const mounted = render(node("slider", { value: 30, on_change: "a:9:0" }));
    const field = query<HTMLInputElement>(mounted, "input.omora-slider");

    expect(field.dataset.type).toBe("slider");
    expect(field.type).toBe("range");
    expect(field.min).toBe("0");
    expect(field.max).toBe("100");
    expect(field.value).toBe("30");
  });

  it("拖动回传数字", () => {
    const mounted = render(node("slider", { value: 30, min: 0, max: 200, on_change: "a:9:0" }));
    const field = query<HTMLInputElement>(mounted, "input");

    field.value = "120";
    change(field);

    expect(mounted.events).toEqual([{ handler: "a:9:0", payload: { value: 120 } }]);
  });

  it("update 原地改范围与值", () => {
    const mounted = render(node("slider", { value: 30, on_change: "a:9:0" }, [], "sl"));
    const field = query<HTMLInputElement>(mounted, "input");

    mounted.render(node("slider", { value: 60, min: 10, max: 80, on_change: "a:9:0" }, [], "sl"));

    expect(query(mounted, "input")).toBe(field);
    expect(field.min).toBe("10");
    expect(field.max).toBe("80");
    expect(field.value).toBe("60");
  });
});

describe("progress", () => {
  it("宽度按 value / max 算成百分比", () => {
    const mounted = render(node("progress", { value: 42, text: "已完成 42" }));
    const progress = query(mounted, ".omora-progress");

    expect(progress.dataset.type).toBe("progress");
    expect(progress.getAttribute("role")).toBe("progressbar");
    expect(progress.getAttribute("aria-valuemin")).toBe("0");
    expect(progress.getAttribute("aria-valuemax")).toBe("100");
    expect(progress.getAttribute("aria-valuenow")).toBe("42");
    expect(query<HTMLElement>(mounted, ".omora-progress-fill").style.width).toBe("42%");
    expect(query(mounted, ".omora-progress-text").textContent).toBe("已完成 42");
  });

  it("按自定义 max 折算，超出范围夹住", () => {
    const quarter = render(node("progress", { value: 1, max: 4 }));
    expect(query<HTMLElement>(quarter, ".omora-progress-fill").style.width).toBe("25%");

    const over = render(node("progress", { value: 150 }));
    expect(query<HTMLElement>(over, ".omora-progress-fill").style.width).toBe("100%");
    expect(query(over, ".omora-progress").getAttribute("aria-valuenow")).toBe("100");

    const under = render(node("progress", { value: -5 }));
    expect(query<HTMLElement>(under, ".omora-progress-fill").style.width).toBe("0%");
    expect(query(under, ".omora-progress").getAttribute("aria-valuenow")).toBe("0");
  });

  it("没有 text 就不画说明", () => {
    const mounted = render(node("progress", { value: 42 }));

    expect(mounted.root.querySelector(".omora-progress-text")).toBeNull();
  });

  it("update 原地改宽度与说明", () => {
    const mounted = render(node("progress", { value: 42, text: "旧" }, [], "p"));
    const progress = query(mounted, ".omora-progress");
    const fill = query<HTMLElement>(mounted, ".omora-progress-fill");
    const caption = query(mounted, ".omora-progress-text");

    mounted.render(node("progress", { value: 80, text: "新" }, [], "p"));

    expect(query(mounted, ".omora-progress")).toBe(progress);
    expect(query(mounted, ".omora-progress-fill")).toBe(fill);
    expect(query(mounted, ".omora-progress-text")).toBe(caption);
    expect(fill.style.width).toBe("80%");
    expect(progress.getAttribute("aria-valuenow")).toBe("80");
    expect(caption.textContent).toBe("新");
  });
});

/** 12 个 kind 的样例树：注册表覆盖与卸载走一遍。 */

/** 6 个输入类 kind 的样例树：注册表覆盖与卸载走一遍。 */
function samples(): Node[] {
  return [
    node("button", { text: "确定", on_click: "a:0:0" }),
    node("input", { placeholder: "记一笔", on_submit: "a:0:1" }),
    node("textarea", { placeholder: "备注", on_submit: "a:0:2" }),
    node("number_input", { value: 3, on_change: "a:0:3" }),
    node("slider", { value: 30, on_change: "a:0:4" }),
    node("progress", { value: 42, text: "已完成" }),
  ];
}

describe("注册表", () => {
  it("输入类 kind 都从注册表画出来，没有未知组件", () => {
    for (const sample of samples()) {
      const mounted = render(sample);
      expect(mounted.root.querySelector(".omora-unknown")).toBeNull();
      expect(mounted.root.querySelector(`[data-type="${sample.type}"]`)).not.toBeNull();
    }
  });

  it("卸载后每个 kind 的元素都从容器移除", () => {
    for (const sample of samples()) {
      const mounted = mount(sample);
      mounted.destroy();
      expect(mounted.root.children).toHaveLength(0);
    }
  });
});

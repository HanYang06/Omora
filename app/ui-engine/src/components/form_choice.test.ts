// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import type { Node } from "../core/types";
import { registry } from "./registry";
import { DomRenderer } from "../renderer/renderer";
import type { Mounted, RecordedEvent } from "./testing";
import type { RenderContext } from "../renderer/types";
import { formChoiceKinds } from "./form_choice";

/** 表单选择类 kind：受控状态、事件 id、局部更新与清理都在真实 DOM 上验。 */

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

function text(content: string, id?: string): Node {
  return node("text", { text: content }, [], id);
}

/**
 * registry 由 Lead 汇总；formChoiceKinds 合并进 registry 之前，这个文件用合并后的
 * 注册表挂树。行为和 ../testing 的 mount 一致：记录事件、卸载时跑清理账本。
 */
function mountChoice(root: Node): Mounted {
  const events: RecordedEvent[] = [];
  const context: RenderContext = {
    event: (handler, payload) => events.push({ handler, payload }),
    loadMedia: () => Promise.resolve({ mime: "", data: "" }),
    cleanup: () => undefined,
  };
  const container = document.createElement("div");
  document.body.appendChild(container);
  const renderer = new DomRenderer({ registry: { ...registry, ...formChoiceKinds }, context });
  renderer.render(root, container);
  return {
    root: container,
    renderer,
    events,
    render: (next) => renderer.render(next, container),
    destroy: () => {
      renderer.dispose();
      container.remove();
    },
  };
}

/** 每个测试挂出去的树统一收尾，避免 DOM 泄漏。 */
const open: Mounted[] = [];

function render(root: Node): Mounted {
  const mounted = mountChoice(root);
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

describe("switch", () => {
  it("画成受控开关：data-on / aria-checked / checked 跟着数据", () => {
    const mounted = render(node("switch", { text: "深色", checked: true, on_change: "a:3:0" }));
    const label = query<HTMLLabelElement>(mounted, ".omora-switch");
    const field = query<HTMLInputElement>(mounted, "input.omora-switch-input");

    expect(label.dataset.type).toBe("switch");
    expect(label.dataset.on).toBe("true");
    expect(field.type).toBe("checkbox");
    expect(field.getAttribute("role")).toBe("switch");
    expect(field.checked).toBe(true);
    expect(field.getAttribute("aria-checked")).toBe("true");
    expect(field.disabled).toBe(false);
    expect(label.textContent).toBe("深色");
  });

  it("拨一下把新值交回去", () => {
    const mounted = render(node("switch", { text: "深色", on_change: "a:3:0" }));
    const field = query<HTMLInputElement>(mounted, "input");

    field.checked = true;
    change(field);

    expect(mounted.events).toEqual([{ handler: "a:3:0", payload: { value: true } }]);
  });

  it("没有 on_change 就禁用，也不发事件", () => {
    const mounted = render(node("switch", { text: "深色" }));
    const field = query<HTMLInputElement>(mounted, "input");

    expect(field.disabled).toBe(true);
    field.checked = true;
    change(field);

    expect(mounted.events).toEqual([]);
  });

  it("update 原地改 checked 与文字", () => {
    const mounted = render(
      node("switch", { text: "深色", checked: true, on_change: "a:3:0" }, [], "s"),
    );
    const label = query(mounted, ".omora-switch");
    const caption = query(mounted, ".omora-switch-text");

    mounted.render(node("switch", { text: "浅色", checked: false, on_change: "a:3:0" }, [], "s"));

    const field = query<HTMLInputElement>(mounted, "input");
    expect(query(mounted, ".omora-switch")).toBe(label);
    expect(query(mounted, ".omora-switch-text")).toBe(caption);
    expect(field.checked).toBe(false);
    expect(label.dataset.on).toBe("false");
    expect(caption.textContent).toBe("浅色");
  });
});

describe("checkbox", () => {
  it("勾上时画 checked，勾一下回传 true", () => {
    const mounted = render(node("checkbox", { text: "置顶", on_change: "a:4:0" }));
    const field = query<HTMLInputElement>(mounted, "input.omora-checkbox-input");

    expect(query(mounted, ".omora-checkbox").dataset.type).toBe("checkbox");
    expect(mounted.root.querySelector(".omora-checkbox-text")?.textContent).toBe("置顶");
    expect(field.checked).toBe(false);

    field.checked = true;
    change(field);

    expect(mounted.events).toEqual([{ handler: "a:4:0", payload: { value: true } }]);
  });

  it("数据说 checked 就画 checked，没有 handler 就禁用", () => {
    const on = render(node("checkbox", { text: "置顶", checked: true, on_change: "a:4:1" }));
    expect(query<HTMLInputElement>(on, "input").checked).toBe(true);

    const disabled = render(node("checkbox", { text: "置顶" }));
    expect(query<HTMLInputElement>(disabled, "input").disabled).toBe(true);
  });
});

describe("radio", () => {
  it("name / value / checked 都是原生属性，value 缺省取文字", () => {
    const mounted = render(
      node("radio", { text: "低", name: "quality", checked: true, on_change: "a:5:0" }),
    );
    const field = query<HTMLInputElement>(mounted, "input.omora-radio-input");

    expect(query(mounted, ".omora-radio").dataset.type).toBe("radio");
    expect(field.type).toBe("radio");
    expect(field.name).toBe("quality");
    expect(field.value).toBe("低");
    expect(field.checked).toBe(true);
  });

  it("点它回传自己的 value", () => {
    const mounted = render(
      node("radio", { text: "低", name: "quality", value: "low", on_change: "a:5:1" }),
    );
    const field = query<HTMLInputElement>(mounted, "input");

    field.checked = true;
    change(field);

    expect(mounted.events).toEqual([{ handler: "a:5:1", payload: { value: "low" } }]);
  });

  it("update 换一组里的选中项", () => {
    const mounted = render(
      node("radio", { text: "高", name: "quality", value: "high", on_change: "a:5:0" }, [], "r"),
    );
    const field = query<HTMLInputElement>(mounted, "input");

    mounted.render(
      node(
        "radio",
        { text: "高", name: "quality", value: "high", checked: true, on_change: "a:5:0" },
        [],
        "r",
      ),
    );

    expect(query(mounted, "input")).toBe(field);
    expect(field.checked).toBe(true);
  });
});

describe("select", () => {
  it("选项来自子节点文字，value 缺省同文字", () => {
    const mounted = render(
      node("select", { on_change: "a:6:0" }, [
        text("北京"),
        node("text", { text: "上海", value: "sh" }),
      ]),
    );
    const field = query<HTMLSelectElement>(mounted, "select.omora-select-input");

    expect(query(mounted, ".omora-select").dataset.type).toBe("select");
    expect(Array.from(field.options, (option) => [option.value, option.textContent])).toEqual([
      ["北京", "北京"],
      ["sh", "上海"],
    ]);
  });

  it("placeholder 是第一个禁用隐藏项，value 空时选中它", () => {
    const mounted = render(
      node("select", { placeholder: "选择城市", value: "", on_change: "a:6:0" }, [text("北京")]),
    );
    const field = query<HTMLSelectElement>(mounted, "select");
    const first = field.options[0];

    expect(first?.value).toBe("");
    expect(first?.textContent).toBe("选择城市");
    expect(first?.disabled).toBe(true);
    expect(first?.hidden).toBe(true);
    expect(field.value).toBe("");
    expect(field.getAttribute("aria-label")).toBe("选择城市");
    expect(field.options).toHaveLength(2);
  });

  it("value 决定选中的那一项", () => {
    const mounted = render(
      node("select", { value: "sh", on_change: "a:6:0" }, [
        text("北京"),
        node("text", { text: "上海", value: "sh" }),
      ]),
    );

    expect(query<HTMLSelectElement>(mounted, "select").value).toBe("sh");
  });

  it("选一项把它的 value 交回去", () => {
    const mounted = render(
      node("select", { value: "bj", on_change: "a:6:0" }, [
        node("text", { text: "北京", value: "bj" }),
        node("text", { text: "上海", value: "sh" }),
      ]),
    );
    const field = query<HTMLSelectElement>(mounted, "select");

    field.value = "sh";
    change(field);

    expect(mounted.events).toEqual([{ handler: "a:6:0", payload: { value: "sh" } }]);
  });

  it("没有 on_change 就禁用", () => {
    const mounted = render(node("select", {}, [text("北京")]));

    expect(query<HTMLSelectElement>(mounted, "select").disabled).toBe(true);
  });

  it("update 原地换选项，不重建 select", () => {
    const mounted = render(
      node(
        "select",
        { value: "bj", on_change: "a:6:0" },
        [node("text", { text: "北京", value: "bj" })],
        "sel",
      ),
    );
    const field = query<HTMLSelectElement>(mounted, "select");

    mounted.render(
      node(
        "select",
        { value: "sh", on_change: "a:6:0" },
        [node("text", { text: "上海", value: "sh" }), node("text", { text: "广州", value: "gz" })],
        "sel",
      ),
    );

    expect(query(mounted, "select")).toBe(field);
    expect(Array.from(field.options, (option) => option.value)).toEqual(["sh", "gz"]);
    expect(field.value).toBe("sh");
  });

  it("选项子节点是数据，不当普通子树画进 DOM", () => {
    const mounted = render(node("select", {}, [text("北京")]));

    expect(mounted.root.querySelector(".omora-text")).toBeNull();
  });
});

describe("field", () => {
  it("label 在上、控件在下、hint 可选", () => {
    const mounted = render(
      node("field", { label: "标题", hint: "一句话说清" }, [
        node("textarea", { placeholder: "写点什么" }),
      ]),
    );
    const field = query(mounted, ".omora-field");

    expect(field.dataset.type).toBe("field");
    expect(query(mounted, ".omora-field-label").textContent).toBe("标题");
    expect(query(mounted, ".omora-field-hint").textContent).toBe("一句话说清");
    expect(field.firstElementChild).toBe(query(mounted, ".omora-field-label"));
    expect(query(mounted, ".omora-field-control").querySelector("textarea")).not.toBeNull();
  });

  it("没有 hint 就不画那一行", () => {
    const mounted = render(node("field", { label: "标题" }, [node("textarea", {})]));

    expect(mounted.root.querySelector(".omora-field-hint")).toBeNull();
  });

  it("update 原地改 label / hint，控件元素不重建", () => {
    const child = node("textarea", { placeholder: "写点什么" }, [], "c");
    const mounted = render(node("field", { label: "旧", hint: "旧提示" }, [child], "f"));
    const field = query(mounted, ".omora-field");
    const label = query(mounted, ".omora-field-label");
    const control = query(mounted, ".omora-field-control");
    const textarea = query(mounted, "textarea");

    mounted.render(node("field", { label: "新" }, [child], "f"));

    expect(query(mounted, ".omora-field")).toBe(field);
    expect(query(mounted, ".omora-field-label")).toBe(label);
    expect(label.textContent).toBe("新");
    expect(mounted.root.querySelector(".omora-field-hint")).toBeNull();
    expect(query(mounted, ".omora-field-control")).toBe(control);
    expect(query(mounted, "textarea")).toBe(textarea);
  });
});

describe("button_group", () => {
  it("只负责排布，按钮还是按钮", () => {
    const mounted = render(
      node("button_group", {}, [
        node("button", { text: "近一周", on_click: "a:10:0" }),
        node("button", { text: "近一月", on_click: "a:10:1" }),
      ]),
    );
    const group = query(mounted, ".omora-button-group");

    expect(group.dataset.type).toBe("button_group");
    expect(group.getAttribute("role")).toBe("group");
    expect(mounted.root.querySelectorAll("button.omora-button")).toHaveLength(2);

    click(query(mounted, '[data-handler="a:10:1"]'));

    expect(mounted.events).toEqual([{ handler: "a:10:1", payload: {} }]);
  });

  it("update 原地换按钮组，不重建容器", () => {
    const mounted = render(
      node("button_group", {}, [node("button", { text: "甲", on_click: "a:10:0" })], "g"),
    );
    const group = query(mounted, ".omora-button-group");

    mounted.render(
      node("button_group", {}, [node("button", { text: "乙", on_click: "a:10:1" })], "g"),
    );

    expect(query(mounted, ".omora-button-group")).toBe(group);
    expect(group.textContent).toBe("乙");
  });
});

/** 6 个选择类 kind 的样例树：注册表覆盖与卸载走一遍。 */
function samples(): Node[] {
  return [
    node("switch", { text: "深色", checked: true, on_change: "a:0:0" }),
    node("checkbox", { text: "置顶", on_change: "a:0:1" }),
    node("radio", { text: "高", name: "quality", value: "high", on_change: "a:0:2" }),
    node("select", { placeholder: "选择", on_change: "a:0:3" }, [text("北京"), text("上海")]),
    node("field", { label: "标题" }, [node("textarea", {})]),
    node("button_group", {}, [node("button", { text: "近一周", on_click: "a:0:4" })]),
  ];
}

describe("注册表", () => {
  it("选择类 kind 都在合并注册表里画出来，没有未知组件", () => {
    for (const sample of samples()) {
      const mounted = render(sample);
      expect(mounted.root.querySelector(".omora-unknown")).toBeNull();
      expect(mounted.root.querySelector(`[data-type="${sample.type}"]`)).not.toBeNull();
    }
  });

  it("卸载后每个 kind 的元素都从容器移除", () => {
    for (const sample of samples()) {
      const mounted = mountChoice(sample);
      mounted.destroy();
      expect(mounted.root.children).toHaveLength(0);
    }
  });
});

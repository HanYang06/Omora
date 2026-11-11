import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  ButtonGroup,
  Checkbox,
  NumberInput,
  Radio,
  Select,
  Slider,
  Switch,
  Textarea,
} from "./controls";
import { renderTree } from "./renderer";
import type { Node } from "../core/types";

/** 静态标记：控件是"节点数据 → DOM 长什么样"，这一层就该在 HTML 上验。 */
function htmlOf(nodes: Node[]): string {
  return renderToStaticMarkup(<>{renderTree(nodes)}</>);
}

function node(type: string, props: Record<string, unknown> = {}, children: Node[] = []): Node {
  return { type, props, children };
}

interface FakeEvent {
  currentTarget: { checked: boolean; value: string };
}

interface FakeKeyEvent extends FakeEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  preventDefault: () => void;
}

interface ControlElement {
  props: {
    checked?: boolean;
    disabled?: boolean;
    onChange?: (event: FakeEvent) => void;
    onBlur?: (event: FakeEvent) => void;
    onKeyDown?: (event: FakeKeyEvent) => void;
  };
}

function asElement(value: unknown): ControlElement {
  return value as ControlElement;
}

function fakeEvent(value: string, checked = false): FakeEvent {
  return { currentTarget: { checked, value } };
}

/** 在无状态控件的返回元素里找真正的 DOM 控件（select / input / textarea）。 */
function findControl(value: unknown, type: string): ControlElement {
  const found: ControlElement[] = [];
  const walk = (candidate: unknown): void => {
    if (Array.isArray(candidate)) {
      candidate.forEach(walk);
      return;
    }
    if (typeof candidate !== "object" || candidate === null) {
      return;
    }
    const element = candidate as { type?: unknown; props?: { children?: unknown } };
    if (element.type === type) {
      found.push(asElement(element));
    }
    if (element.props?.children !== undefined) {
      walk(element.props.children);
    }
  };
  walk(value);
  const control = found[0];
  if (control === undefined) {
    throw new Error("没找到 " + type + " 控件");
  }
  return control;
}

describe("switch / checkbox / radio", () => {
  it("switch 的 aria 状态跟着 checked 走", () => {
    const on = htmlOf([node("switch", { text: "深色", checked: true, on_change: "prefs:1:0" })]);
    const off = htmlOf([node("switch", { text: "深色", checked: false, on_change: "prefs:1:0" })]);

    expect(on).toContain('role="switch"');
    expect(on).toContain('aria-checked="true"');
    expect(on).toContain('checked=""');
    expect(off).toContain('aria-checked="false"');
    expect(off).not.toContain('checked=""');
  });

  it("switch 拨一下把新值交给 on_change", () => {
    const onEvent = vi.fn();
    const control = findControl(
      Switch({
        node: node("switch", { text: "深色", checked: false, on_change: "prefs:1:0" }),
        onEvent,
      }),
      "input",
    );

    control.props.onChange?.(fakeEvent("", true));

    expect(onEvent).toHaveBeenCalledWith("prefs:1:0", { value: true });
  });

  it("switch 没有 on_change 就禁用，点了也不发事件", () => {
    const onEvent = vi.fn();
    const control = findControl(
      Switch({ node: node("switch", { text: "深色", checked: false }), onEvent }),
      "input",
    );

    expect(control.props.disabled).toBe(true);
    control.props.onChange?.(fakeEvent("", true));

    expect(onEvent).not.toHaveBeenCalled();
  });

  it("checkbox 勾上时画 checked，勾一下回传 true", () => {
    const onEvent = vi.fn();
    const html = htmlOf([
      node("checkbox", { text: "置顶", checked: true, on_change: "ideas:2:0" }),
    ]);
    const control = findControl(
      Checkbox({ node: node("checkbox", { text: "置顶", on_change: "ideas:2:0" }), onEvent }),
      "input",
    );

    control.props.onChange?.(fakeEvent("", true));

    expect(html).toContain('type="checkbox"');
    expect(html).toContain('checked=""');
    expect(html).toContain("置顶");
    expect(onEvent).toHaveBeenCalledWith("ideas:2:0", { value: true });
  });

  it("radio 一组里只有 checked 的那个被选中，点它回传自己的 value", () => {
    const onEvent = vi.fn();
    const group = [
      node("radio", { text: "高", name: "quality", value: "high", on_change: "a:1:0" }),
      node("radio", {
        text: "低",
        name: "quality",
        value: "low",
        checked: true,
        on_change: "a:1:0",
      }),
    ];
    const html = htmlOf(group);
    const control = findControl(
      Radio({
        node: node("radio", { text: "低", name: "quality", value: "low", on_change: "a:1:0" }),
        onEvent,
      }),
      "input",
    );

    control.props.onChange?.(fakeEvent("low"));

    expect(html.match(/<input[^>]*type="radio"/g) ?? []).toHaveLength(2);
    expect(html).toContain('name="quality"');
    expect(html.match(/checked=""/g) ?? []).toHaveLength(1);
    expect(onEvent).toHaveBeenCalledWith("a:1:0", { value: "low" });
  });
});

describe("select", () => {
  it("选项来自子节点的文字，value 缺省就是它自己", () => {
    const html = htmlOf([
      node("select", { placeholder: "选择城市", on_change: "a:2:0" }, [
        node("text", { text: "北京" }),
        node("text", { text: "上海", value: "sh" }),
      ]),
    ]);

    expect(html).toContain('data-type="select"');
    expect(html).toContain('<option value="北京">北京</option>');
    expect(html).toContain('<option value="sh">上海</option>');
    expect(html).toContain("选择城市");
  });

  it("选中的那一项带 selected", () => {
    const html = htmlOf([
      node("select", { value: "sh", on_change: "a:2:0" }, [
        node("text", { text: "北京" }),
        node("text", { text: "上海", value: "sh" }),
      ]),
    ]);

    expect(html).toContain('<option value="sh" selected="">上海</option>');
  });

  it("选一项把它的 value 交回去", () => {
    const onEvent = vi.fn();
    const select = findControl(
      Select({
        node: node("select", { value: "bj", on_change: "a:2:0" }, [
          node("text", { text: "北京", value: "bj" }),
        ]),
        onEvent,
      }),
      "select",
    );

    select.props.onChange?.(fakeEvent("bj"));

    expect(onEvent).toHaveBeenCalledWith("a:2:0", { value: "bj" });
  });
});

describe("textarea", () => {
  it("失焦把整段文字交回去", () => {
    const onEvent = vi.fn();
    const element = asElement(
      Textarea({
        node: node("textarea", { value: "旧的", on_submit: "a:3:0" }),
        onEvent,
      }),
    );

    element.props.onBlur?.(fakeEvent("第一行\n第二行"));

    expect(onEvent).toHaveBeenCalledWith("a:3:0", { value: "第一行\n第二行" });
  });

  it("普通回车只是换行，Ctrl + Enter 才提交", () => {
    const onEvent = vi.fn();
    const preventDefault = vi.fn();
    const element = asElement(
      Textarea({ node: node("textarea", { on_submit: "a:3:0" }), onEvent }),
    );

    element.props.onKeyDown?.({
      ...fakeEvent("第一行"),
      key: "Enter",
      ctrlKey: false,
      metaKey: false,
      preventDefault,
    });
    expect(onEvent).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();

    element.props.onKeyDown?.({
      ...fakeEvent("第一行"),
      key: "Enter",
      ctrlKey: true,
      metaKey: false,
      preventDefault,
    });
    expect(onEvent).toHaveBeenCalledWith("a:3:0", { value: "第一行" });
  });

  it("画成多行输入，placeholder 与预填都在", () => {
    const html = htmlOf([node("textarea", { placeholder: "备注", value: "旧的", rows: 5 })]);

    expect(html).toContain("<textarea");
    expect(html).toContain('placeholder="备注"');
    expect(html).toContain('rows="5"');
    expect(html).toContain("旧的");
  });
});

describe("number_input / slider", () => {
  it("number_input 把输入解析成数字回传", () => {
    const onEvent = vi.fn();
    const element = asElement(
      NumberInput({
        node: node("number_input", { value: 3, min: 1, max: 10, on_change: "a:4:0" }),
        onEvent,
      }),
    );

    element.props.onChange?.(fakeEvent("7"));

    expect(onEvent).toHaveBeenCalledWith("a:4:0", { value: 7 });
  });

  it("number_input 空值不回传", () => {
    const onEvent = vi.fn();
    const element = asElement(
      NumberInput({ node: node("number_input", { on_change: "a:4:1" }), onEvent }),
    );

    element.props.onChange?.(fakeEvent(""));

    expect(onEvent).not.toHaveBeenCalled();
  });

  it("number_input 把上下限画成原生属性", () => {
    const html = htmlOf([
      node("number_input", { value: 3, min: 1, max: 10, step: 1, on_change: "a:4:2" }),
    ]);

    expect(html).toContain('type="number"');
    expect(html).toContain('min="1"');
    expect(html).toContain('max="10"');
    expect(html).toContain('step="1"');
    expect(html).toContain('value="3"');
  });

  it("slider 回传拖到的那一点", () => {
    const onEvent = vi.fn();
    const element = asElement(
      Slider({
        node: node("slider", { value: 30, min: 0, max: 200, on_change: "a:5:0" }),
        onEvent,
      }),
    );

    element.props.onChange?.(fakeEvent("120"));

    expect(onEvent).toHaveBeenCalledWith("a:5:0", { value: 120 });
  });

  it("slider 默认 0–100，值从数据来", () => {
    const html = htmlOf([node("slider", { value: 30, on_change: "a:5:1" })]);

    expect(html).toContain('type="range"');
    expect(html).toContain('min="0"');
    expect(html).toContain('max="100"');
    expect(html).toContain('value="30"');
  });
});

describe("field / button_group", () => {
  it("field 的 label 与控件一起画出来，label 在前", () => {
    const html = htmlOf([
      node("field", { label: "标题", hint: "一句话说清" }, [
        node("textarea", { placeholder: "写点什么" }),
      ]),
    ]);

    expect(html).toContain('data-type="field"');
    expect(html).toContain("标题");
    expect(html).toContain('placeholder="写点什么"');
    expect(html).toContain('data-type="textarea"');
    expect(html.indexOf("标题")).toBeLessThan(html.indexOf("写点什么"));
    expect(html).toContain("一句话说清");
  });

  it("field 没有 hint 就不画那一行", () => {
    const html = htmlOf([
      node("field", { label: "标题" }, [node("textarea", { placeholder: "写点什么" })]),
    ]);

    expect(html).not.toContain("omora-field-hint");
  });

  it("button_group 只负责排布，按钮还是按钮", () => {
    const html = htmlOf([
      node("button_group", {}, [
        node("button", { text: "近一周", on_click: "a:6:0" }),
        node("button", { text: "近一月", on_click: "a:6:1" }),
      ]),
    ]);

    expect(html).toContain('data-type="button_group"');
    expect(html).toContain('role="group"');
    expect(html).toContain('data-handler="a:6:0"');
    expect(html).toContain('data-handler="a:6:1"');
    expect(html).toContain("近一周");
    expect(html).toContain("近一月");
  });

  it("button_group 认 children 里的按钮元素（直接调用时也一样）", () => {
    const html = renderToStaticMarkup(
      <>
        {ButtonGroup({
          node: node("button_group"),
          children: <button type="button">近一周</button>,
        })}
      </>,
    );

    expect(html).toContain("omora-button-group");
    expect(html).toContain("近一周");
  });
});

describe("tabs", () => {
  const tabs = node("tabs", {}, [
    node("column", { label: "全部" }, [node("text", { text: "第一条灵感" })]),
    node("column", { label: "已归档" }, [node("text", { text: "归档的那条" })]),
  ]);

  it("默认选中第一页，只有它的内容是展开的", () => {
    const html = htmlOf([tabs]);
    const panels = html.split('role="tabpanel"');

    expect(html).toContain('role="tablist"');
    expect(html).toContain("全部");
    expect(html).toContain("已归档");
    expect(html.indexOf('aria-selected="true"')).toBeGreaterThan(-1);
    expect(html.indexOf('aria-selected="true"')).toBeLessThan(
      html.indexOf('aria-selected="false"'),
    );
    expect(panels[1] ?? "").not.toContain('hidden=""');
    expect(panels[2] ?? "").toContain('hidden=""');
  });

  it("两页的内容都在树里，切换不重新要数据", () => {
    const html = htmlOf([tabs]);

    expect(html).toContain("第一条灵感");
    expect(html).toContain("归档的那条");
    expect(html.match(/role="tabpanel"/g) ?? []).toHaveLength(2);
  });
});

describe("accordion", () => {
  const sections = () => [
    node("column", { label: "怎么录" }, [node("text", { text: "按空格开始" })]),
    node("column", { label: "存哪儿" }, [node("text", { text: "存在本地" })]),
  ];

  it("默认全部收起：不画正文，aria-expanded 都是 false", () => {
    const html = htmlOf([node("accordion", {}, sections())]);

    expect(html).toContain('data-type="accordion"');
    expect(html).toContain("怎么录");
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('aria-expanded="true"');
    expect(html).not.toContain("omora-accordion-body");
    expect(html).not.toContain("按空格开始");
  });

  it("open 指定初始展开那一节，只展开这一节", () => {
    const html = htmlOf([node("accordion", { open: 1 }, sections())]);

    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("omora-accordion-body");
    expect(html).toContain("存在本地");
    expect(html).not.toContain("按空格开始");
  });
});

describe("progress", () => {
  it("宽度按 value / max 算成百分比", () => {
    const html = htmlOf([node("progress", { value: 42, text: "已完成 42" })]);

    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="42"');
    expect(html).toContain('aria-valuemax="100"');
    expect(html).toContain("width:42%");
    expect(html).toContain("已完成 42");
  });

  it("按自定义 max 折算", () => {
    const html = htmlOf([node("progress", { value: 1, max: 4 })]);

    expect(html).toContain('aria-valuemax="4"');
    expect(html).toContain("width:25%");
  });

  it("超出范围就夹在 0–100%", () => {
    const over = htmlOf([node("progress", { value: 150 })]);
    const under = htmlOf([node("progress", { value: -5 })]);

    expect(over).toContain("width:100%");
    expect(over).toContain('aria-valuenow="100"');
    expect(under).toContain("width:0%");
    expect(under).toContain('aria-valuenow="0"');
  });
});

describe("注册表", () => {
  it("12 个控件都从注册表画出来，没有未知组件兜底", () => {
    const html = htmlOf([
      node("switch", { text: "深色", checked: true, on_change: "a:7:0" }),
      node("checkbox", { text: "置顶", checked: true, on_change: "a:7:1" }),
      node("radio", { text: "高", name: "quality", value: "high", on_change: "a:7:2" }),
      node("select", { value: "sh", on_change: "a:7:3" }, [node("text", { text: "上海" })]),
      node("textarea", { placeholder: "备注", on_submit: "a:7:4" }),
      node("number_input", { value: 3, on_change: "a:7:5" }),
      node("slider", { value: 30, on_change: "a:7:6" }),
      node("field", { label: "标题" }, [node("text", { text: "控件" })]),
      node("button_group", {}, [node("button", { text: "近一周", on_click: "a:7:7" })]),
      node("tabs", {}, [node("column", { label: "全部" }, [])]),
      node("accordion", {}, [node("column", { label: "怎么录" }, [])]),
      node("progress", { value: 42 }),
    ]);

    expect(html).not.toContain("omora-unknown");
    expect(html).not.toContain("未知组件");
  });
});

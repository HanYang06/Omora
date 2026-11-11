import { Children, useId, useState, type KeyboardEvent, type ReactNode } from "react";
import { flag, prop, textOf, type NodeComponentProps } from "../core/shared";
import type { EventHandler, Node } from "../core/types";

/**
 * 基础控件：表单（switch / checkbox / radio / select / textarea / number_input /
 * slider / field / button_group）与反馈（tabs / accordion / progress）。
 *
 * 约定（和现有组件一致）：
 *
 * - 文字一律走 props.text（textOf），开关走 props 里的布尔（flag），其余字符串走
 *   prop()。数字单独读：Python 侧的 int / float 到这里是 number，不是 string。
 * - 事件只有一种：on_change（textarea 是 on_submit），载荷统一 {"value": ...}。
 *   没有 handler id 就只画不回应；需要交互的控件此时禁用，和 Button / Tile 一样。
 * - 值从数据来：开、选、勾由 props 决定，事件回 Python；Python 改数据后 refresh，
 *   这里跟着变。例外是连续输入（textarea / number_input / slider）：它们不被状态
 *   接管，在途输入以用户为准（同 Input）。
 * - 局部状态只有两处，都不回 Python：Tabs 选第几页、Accordion 展开第几项。
 * - Tabs / Accordion / Select 的"条目"就是 children：每个子节点的 props.label
 *   （缺省 title，再缺省 text）是它的头；Select 的子节点是 text 节点，文字是选项，
 *   props.value 是提交值（缺省同文字）。
 */

/**
 * props 里的数字。Python 的 int / float 到这儿是 number；也收数字字符串，
 * 免得两套写法各画一套。
 */
function numeric(node: Node, name: string): number | undefined {
  const value = node.props?.[name];
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

interface Binding {
  /** 有没有挂 handler id：没有就画成禁用。 */
  active: boolean;
  emit: (payload: Record<string, unknown>) => void;
}

/** 把 props 里的 handler id 包成"有 id 才发"的发射器。 */
function binding(node: Node, name: string, onEvent: EventHandler | undefined): Binding {
  const handler = prop(node, name);
  const active = handler !== undefined && handler.length > 0;
  return {
    active,
    emit: (payload) => {
      if (handler !== undefined && handler.length > 0) {
        onEvent?.(handler, payload);
      }
    },
  };
}

/** 条目的头：props.label 优先，其次 title，最后是文字本身。 */
function headingOf(item: Node | undefined): string {
  if (item === undefined) {
    return "";
  }
  const label = prop(item, "label");
  if (label !== undefined && label.length > 0) {
    return label;
  }
  const title = prop(item, "title");
  if (title !== undefined && title.length > 0) {
    return title;
  }
  return textOf(item);
}

/** switch：开关。checked 由数据决定，拨一下把新值交回去。 */
export function Switch({ node, onEvent }: NodeComponentProps): ReactNode {
  const text = textOf(node);
  const checked = flag(node, "checked");
  const change = binding(node, "on_change", onEvent);

  return (
    <label className="omora-switch" data-type="switch" data-on={checked}>
      <input
        className="omora-switch-input"
        type="checkbox"
        role="switch"
        aria-checked={checked}
        checked={checked}
        disabled={!change.active || flag(node, "disabled")}
        onChange={(event) => {
          change.emit({ value: event.currentTarget.checked });
        }}
      />
      {text.length > 0 ? <span className="omora-switch-text">{text}</span> : null}
    </label>
  );
}

/** checkbox：复选。checked 由数据决定，勾一下把新值交回去。 */
export function Checkbox({ node, onEvent }: NodeComponentProps): ReactNode {
  const text = textOf(node);
  const checked = flag(node, "checked");
  const change = binding(node, "on_change", onEvent);

  return (
    <label className="omora-checkbox" data-type="checkbox">
      <input
        className="omora-checkbox-input"
        type="checkbox"
        checked={checked}
        disabled={!change.active || flag(node, "disabled")}
        onChange={(event) => {
          change.emit({ value: event.currentTarget.checked });
        }}
      />
      {text.length > 0 ? <span className="omora-checkbox-text">{text}</span> : null}
    </label>
  );
}

/** radio：单选。同一 name 的是一组；value 是提交值，checked 由数据决定。 */
export function Radio({ node, onEvent }: NodeComponentProps): ReactNode {
  const text = textOf(node);
  const name = prop(node, "name") ?? "";
  const value = prop(node, "value") ?? text;
  const checked = flag(node, "checked");
  const change = binding(node, "on_change", onEvent);

  return (
    <label className="omora-radio" data-type="radio">
      <input
        className="omora-radio-input"
        type="radio"
        name={name}
        value={value}
        checked={checked}
        disabled={!change.active || flag(node, "disabled")}
        onChange={() => {
          change.emit({ value });
        }}
      />
      {text.length > 0 ? <span className="omora-radio-text">{text}</span> : null}
    </label>
  );
}

/** select：下拉。子节点是 text 节点，文字是选项；props.value 是提交值。 */
export function Select({ node, onEvent }: NodeComponentProps): ReactNode {
  const options = Array.isArray(node.children) ? node.children : [];
  const value = prop(node, "value") ?? "";
  const placeholder = prop(node, "placeholder");
  const change = binding(node, "on_change", onEvent);

  return (
    <div className="omora-select" data-type="select">
      <select
        className="omora-select-input"
        value={value}
        aria-label={placeholder}
        disabled={!change.active || flag(node, "disabled")}
        onChange={(event) => {
          change.emit({ value: event.currentTarget.value });
        }}
      >
        {placeholder !== undefined && placeholder.length > 0 ? (
          <option value="" disabled hidden>
            {placeholder}
          </option>
        ) : null}
        {options.map((option, index) => {
          const label = textOf(option);
          return (
            <option key={String(index)} value={prop(option, "value") ?? label}>
              {label}
            </option>
          );
        })}
      </select>
    </div>
  );
}

/**
 * textarea：多行输入。输入不被状态接管（和 Input 一样，用户改过就以用户为准）；
 * 失焦或 Ctrl / Cmd + Enter 把值交回去，普通回车只是换行。
 */
export function Textarea({ node, onEvent }: NodeComponentProps): ReactNode {
  const value = prop(node, "value");
  const submit = binding(node, "on_submit", onEvent);

  const commit = (field: HTMLTextAreaElement): void => {
    submit.emit({ value: field.value });
  };

  return (
    <textarea
      className="omora-textarea"
      data-type="textarea"
      placeholder={prop(node, "placeholder") ?? ""}
      defaultValue={value ?? ""}
      rows={numeric(node, "rows") ?? 3}
      disabled={flag(node, "disabled")}
      onBlur={(event) => {
        commit(event.currentTarget);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          commit(event.currentTarget);
        }
      }}
    />
  );
}

/** number_input：数字输入。回传的是 number，不是字符串；空值不回传。 */
export function NumberInput({ node, onEvent }: NodeComponentProps): ReactNode {
  const change = binding(node, "on_change", onEvent);

  return (
    <input
      className="omora-number"
      data-type="number_input"
      type="number"
      defaultValue={numeric(node, "value")}
      min={numeric(node, "min")}
      max={numeric(node, "max")}
      step={numeric(node, "step")}
      disabled={flag(node, "disabled")}
      onChange={(event) => {
        const raw = event.currentTarget.value;
        if (raw.length === 0) {
          return;
        }
        const parsed = Number(raw);
        if (Number.isFinite(parsed)) {
          change.emit({ value: parsed });
        }
      }}
    />
  );
}

/** slider：拖动条。拖动中不回弹（输入不被状态接管），每个变化都回传 number。 */
export function Slider({ node, onEvent }: NodeComponentProps): ReactNode {
  const change = binding(node, "on_change", onEvent);

  return (
    <input
      className="omora-slider"
      data-type="slider"
      type="range"
      defaultValue={numeric(node, "value") ?? 0}
      min={numeric(node, "min") ?? 0}
      max={numeric(node, "max") ?? 100}
      step={numeric(node, "step")}
      disabled={flag(node, "disabled")}
      onChange={(event) => {
        const parsed = Number(event.currentTarget.value);
        if (Number.isFinite(parsed)) {
          change.emit({ value: parsed });
        }
      }}
    />
  );
}

/** field：一行表单。label 在上，控件在下，可选一句 hint；子节点是控件。 */
export function Field({ node, children }: NodeComponentProps): ReactNode {
  const label = prop(node, "label") ?? "";
  const hint = prop(node, "hint");

  return (
    <div className="omora-field" data-type="field">
      {label.length > 0 ? <span className="omora-field-label">{label}</span> : null}
      <div className="omora-field-control">{children}</div>
      {hint !== undefined && hint.length > 0 ? (
        <span className="omora-field-hint">{hint}</span>
      ) : null}
    </div>
  );
}

/** button_group：一组按钮排成一段。子节点是 button；样式只管排布，不改按钮语义。 */
export function ButtonGroup({ children }: NodeComponentProps): ReactNode {
  return (
    <div className="omora-button-group" data-type="button_group" role="group">
      {children}
    </div>
  );
}

/**
 * tabs：标签页。子节点是每一页的内容，子节点的 label（缺省 title / text）是标签名。
 * 选中第几页是局部状态，默认第一页，不回 Python。
 */
export function Tabs({ node, children }: NodeComponentProps): ReactNode {
  const panels = Children.toArray(children);
  const items = Array.isArray(node.children) ? node.children : [];
  const [active, setActive] = useState(0);
  const count = panels.length;
  const current = count === 0 ? -1 : Math.min(Math.max(active, 0), count - 1);
  const base = useId();

  const move = (event: KeyboardEvent<HTMLDivElement>): void => {
    const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (delta === 0 || count === 0) {
      return;
    }
    event.preventDefault();
    setActive((position) => (((position + delta) % count) + count) % count);
  };

  return (
    <div className="omora-tabs" data-type="tabs">
      <div className="omora-tabs-bar" role="tablist" onKeyDown={move}>
        {panels.map((_, position) => (
          <button
            key={String(position)}
            type="button"
            role="tab"
            id={base + "-tab-" + String(position)}
            aria-controls={base + "-panel-" + String(position)}
            aria-selected={position === current}
            className={position === current ? "omora-tab is-active" : "omora-tab"}
            onClick={() => {
              setActive(position);
            }}
          >
            {headingOf(items[position])}
          </button>
        ))}
      </div>
      {panels.map((panel, position) => (
        <div
          key={String(position)}
          className="omora-tabs-panel"
          role="tabpanel"
          id={base + "-panel-" + String(position)}
          aria-labelledby={base + "-tab-" + String(position)}
          hidden={position !== current}
        >
          {panel}
        </div>
      ))}
    </div>
  );
}

/**
 * accordion：折叠面板。子节点是每一节，子节点的 label（缺省 title / text）是标题，
 * 子树是展开后的内容。默认全部收起，一次只开一节；展开第几项是局部状态，不回 Python。
 * props.open 给初始展开的那一节（缺省全收起）。
 */
export function Accordion({ node, children }: NodeComponentProps): ReactNode {
  const panels = Children.toArray(children);
  const items = Array.isArray(node.children) ? node.children : [];
  const [open, setOpen] = useState<number | null>(() => {
    const initial = numeric(node, "open");
    return initial === undefined ? null : initial;
  });

  return (
    <div className="omora-accordion" data-type="accordion">
      {panels.map((panel, position) => {
        const expanded = position === open;
        return (
          <section key={String(position)} className="omora-accordion-item" data-open={expanded}>
            <button
              type="button"
              className="omora-accordion-head"
              aria-expanded={expanded}
              onClick={() => {
                setOpen(expanded ? null : position);
              }}
            >
              <span className="omora-accordion-title">{headingOf(items[position])}</span>
              <span className="omora-accordion-mark" aria-hidden="true">
                {expanded ? "−" : "+"}
              </span>
            </button>
            {expanded ? <div className="omora-accordion-body">{panel}</div> : null}
          </section>
        );
      })}
    </div>
  );
}

/** progress：进度条。value / max 决定填充宽度，text 是它下面那行说明（可选）。 */
export function Progress({ node }: NodeComponentProps): ReactNode {
  const max = numeric(node, "max") ?? 100;
  const value = numeric(node, "value") ?? 0;
  const now = Math.min(Math.max(value, 0), max);
  const ratio = max > 0 ? now / max : 0;
  const percent = Math.round(Math.min(Math.max(ratio, 0), 1) * 1000) / 10;
  const caption = textOf(node);

  return (
    <div
      className="omora-progress"
      data-type="progress"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={now}
    >
      <div className="omora-progress-track">
        <div className="omora-progress-fill" style={{ width: percent + "%" }} />
      </div>
      {caption.length > 0 ? <span className="omora-progress-text">{caption}</span> : null}
    </div>
  );
}

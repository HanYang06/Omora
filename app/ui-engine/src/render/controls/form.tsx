import type { ReactNode } from "react";
import { flag, prop, textOf, type NodeComponentProps } from "../../core/shared";
import { binding, numeric } from "./shared";

/** 表单控件：开关、勾选、下拉、多行、数字、拖动、表单行、按钮组。 */

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

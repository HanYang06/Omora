import { Children, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { IconGlyph } from "../shell/icons";
import { highlightParts, keyAction } from "./searchText";
import { prop, type NodeComponentProps } from "../core/shared";

/** 打字之后等这么久再问后端；再敲一下就重新计时。 */
export const SEARCH_DEBOUNCE_MS = 200;

function marked(text: string, query: string | undefined): ReactNode {
  return highlightParts(text, query).map((segment, index) =>
    segment.hit ? <mark key={index}>{segment.text}</mark> : <span key={index}>{segment.text}</span>,
  );
}

/**
 * search：打字（防抖）问后端，回车或按钮提交，上下键选建议，Esc 收下拉。
 * 建议是子节点：插件给什么就画什么，引擎不认识"搜什么"。
 */
export function Search({ node, onEvent, children }: NodeComponentProps): ReactNode {
  const placeholder = prop(node, "placeholder") ?? "";
  const value = prop(node, "value") ?? "";
  const onQuery = prop(node, "on_query");
  const onSubmit = prop(node, "on_submit");
  const suggestions = Array.isArray(node.children) ? node.children : [];
  const [text, setText] = useState(value);
  const [active, setActive] = useState(-1);
  const [dismissed, setDismissed] = useState(false);
  const sent = useRef(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopTimer = (): void => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };

  // 新快照带来的 value（提交、选中建议）覆盖本地输入
  useEffect(() => {
    if (value === sent.current) {
      return;
    }
    sent.current = value;
    setText(value);
  }, [value]);

  useEffect(() => stopTimer, []);

  const ask = (next: string): void => {
    stopTimer();
    if (onQuery === undefined) {
      return;
    }
    timer.current = setTimeout(() => {
      sent.current = next;
      onEvent?.(onQuery, { value: next });
    }, SEARCH_DEBOUNCE_MS);
  };

  const submit = (next: string): void => {
    const trimmed = next.trim();
    if (trimmed.length === 0 || onSubmit === undefined) {
      return;
    }
    stopTimer();
    sent.current = trimmed;
    setText(trimmed);
    setDismissed(true);
    setActive(-1);
    onEvent?.(onSubmit, { value: trimmed });
  };

  const pick = (index: number): void => {
    const suggestion = suggestions[index];
    const handler = suggestion === undefined ? undefined : prop(suggestion, "on_pick");
    const asked = suggestion === undefined ? undefined : prop(suggestion, "value");
    if (handler === undefined || asked === undefined) {
      return;
    }
    stopTimer();
    sent.current = asked;
    setText(asked);
    setDismissed(true);
    setActive(-1);
    onEvent?.(handler, { value: asked });
  };

  const open = !dismissed && suggestions.length > 0;
  const items = Children.toArray(children);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    const action = keyAction(event.key, {
      open,
      active,
      count: suggestions.length,
      text,
    });
    if (action.kind === "none") {
      return;
    }
    event.preventDefault();
    if (action.kind === "move") {
      setActive(action.active ?? -1);
    } else if (action.kind === "close") {
      setDismissed(true);
      setActive(-1);
    } else if (action.kind === "pick") {
      pick(action.active ?? -1);
    } else {
      submit(text);
    }
  };

  return (
    <div className="omora-search" data-type="search" data-open={open ? "true" : "false"}>
      <div className="omora-search-row">
        <span className="omora-search-icon" aria-hidden="true">
          <IconGlyph name="search" />
        </span>
        <input
          className="omora-search-input"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          data-type="search-input"
          placeholder={placeholder}
          value={text}
          onChange={(event) => {
            setText(event.currentTarget.value);
            setDismissed(false);
            setActive(-1);
            ask(event.currentTarget.value);
          }}
          onKeyDown={onKeyDown}
        />
        <button
          type="button"
          className="omora-search-submit"
          data-type="search-submit"
          disabled={onSubmit === undefined}
          onClick={() => submit(text)}
        >
          搜索
        </button>
      </div>
      {open ? (
        <div className="omora-search-list" role="listbox" data-type="search-list">
          {suggestions.map((suggestion, index) => (
            <div
              key={index}
              role="presentation"
              className={
                index === active
                  ? "omora-search-option omora-search-option--active"
                  : "omora-search-option"
              }
            >
              {items[index] ?? null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** suggestion：下拉里的一条。点一下就把它的 value 当查询交回去。 */
export function Suggestion({ node, onEvent }: NodeComponentProps): ReactNode {
  const handler = prop(node, "on_pick");
  const value = prop(node, "value") ?? "";
  const meta = prop(node, "meta");

  return (
    <button
      type="button"
      role="option"
      className="omora-suggestion"
      data-type="suggestion"
      data-handler={handler}
      onClick={() => {
        if (handler !== undefined) {
          onEvent?.(handler, { value });
        }
      }}
    >
      <span className="omora-suggestion-title">
        {marked(prop(node, "title") ?? "", prop(node, "highlight"))}
      </span>
      {meta !== undefined && meta.length > 0 ? (
        <span className="omora-suggestion-meta">{meta}</span>
      ) : null}
    </button>
  );
}

/** result：一条搜索结果。标题可点，snippet 里把命中的词标出来。 */
export function Result({ node, onEvent }: NodeComponentProps): ReactNode {
  const handler = prop(node, "on_click");

  return (
    <li className="omora-result" data-type="result">
      <button
        type="button"
        className="omora-result-title"
        data-handler={handler}
        onClick={() => {
          if (handler !== undefined) {
            onEvent?.(handler, {});
          }
        }}
      >
        {prop(node, "title") ?? ""}
      </button>
      <p className="omora-result-snippet">
        {marked(prop(node, "snippet") ?? "", prop(node, "highlight"))}
      </p>
      <span className="omora-result-meta">{prop(node, "meta") ?? ""}</span>
    </li>
  );
}

/**
 * 搜索里跟界面无关的那部分：把命中的词切成段、键盘该做什么。
 * 纯函数，渲染引擎的测试直接钉它们；插件换后端不影响这里。
 */

export interface TextSegment {
  text: string;
  hit: boolean;
}

/** 把查询的每次出现切成段（大小写不敏感），其余原样，给 <mark> 用。 */
export function highlightParts(text: string, query: string | undefined): TextSegment[] {
  if (text.length === 0) {
    return [];
  }
  const needle = (query ?? "").trim();
  if (needle.length === 0) {
    return [{ text, hit: false }];
  }
  const haystack = text.toLowerCase();
  const low = needle.toLowerCase();
  const parts: TextSegment[] = [];
  let from = 0;
  let at = haystack.indexOf(low, from);
  while (at !== -1) {
    if (at > from) {
      parts.push({ text: text.slice(from, at), hit: false });
    }
    parts.push({ text: text.slice(at, at + needle.length), hit: true });
    from = at + needle.length;
    at = haystack.indexOf(low, from);
  }
  if (from < text.length) {
    parts.push({ text: text.slice(from), hit: false });
  }
  return parts;
}

/** 上下键在输入框（-1）与建议之间走；到头就停。 */
export function moveActive(active: number, delta: number, count: number): number {
  if (count === 0) {
    return -1;
  }
  const next = active + delta;
  if (next < -1) {
    return -1;
  }
  return next > count - 1 ? count - 1 : next;
}

export interface KeyAction {
  kind: "none" | "move" | "close" | "submit" | "pick";
  active?: number;
}

/**
 * 输入框里按一个键，该做什么。
 * 回车在有选中建议时取那一条，否则提交输入框里的字；Esc 只收下拉。
 */
export function keyAction(
  key: string,
  options: { open: boolean; active: number; count: number; text: string },
): KeyAction {
  const { open, active, count, text } = options;
  if (key === "ArrowDown") {
    return open ? { kind: "move", active: moveActive(active, 1, count) } : { kind: "none" };
  }
  if (key === "ArrowUp") {
    return open ? { kind: "move", active: moveActive(active, -1, count) } : { kind: "none" };
  }
  if (key === "Escape") {
    return open ? { kind: "close" } : { kind: "none" };
  }
  if (key !== "Enter") {
    return { kind: "none" };
  }
  if (open && active >= 0 && active < count) {
    return { kind: "pick", active };
  }
  return text.trim().length > 0 ? { kind: "submit" } : { kind: "none" };
}

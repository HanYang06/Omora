import { describe, expect, it } from "vitest";
import { hotkeyDecision, isTypingTarget, keyMatches, type HotkeyFacts } from "./hotkey-rules";

/** 一次普通的空格按下：不在输入框、没长按、还没按住过。 */
function facts(overrides: Partial<HotkeyFacts> = {}): HotkeyFacts {
  return {
    configured: "space",
    code: "Space",
    key: " ",
    repeat: false,
    editing: false,
    held: false,
    phase: "down",
    ...overrides,
  };
}

describe("认不认这个键", () => {
  it("按 code 认，大小写不敏感", () => {
    expect(keyMatches("keyr", "KeyR", "r")).toBe(true);
    expect(keyMatches("space", "Space", " ")).toBe(true);
  });

  it("没有 code 的环境按 key 认，配置两边多余的空白不算数", () => {
    expect(keyMatches("enter", "", "Enter")).toBe(true);
    expect(keyMatches("  space  ", "Space", " ")).toBe(true);
  });

  it("别的键不认；空配置永远不认", () => {
    expect(keyMatches("space", "KeyA", "a")).toBe(false);
    expect(keyMatches("", "Space", " ")).toBe(false);
  });
});

describe("焦点在输入控件里", () => {
  it("input / textarea / contentEditable 算在编辑", () => {
    expect(isTypingTarget({ tagName: "INPUT" })).toBe(true);
    expect(isTypingTarget({ tagName: "textarea" })).toBe(true);
    expect(isTypingTarget({ isContentEditable: true })).toBe(true);
  });

  it("普通元素、null、非对象都不算", () => {
    expect(isTypingTarget({ tagName: "DIV" })).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget("input")).toBe(false);
  });
});

describe("按下 / 松开要发什么", () => {
  it("按下：拦住空格滚动，发 press，记住按住了", () => {
    expect(hotkeyDecision(facts())).toEqual({
      action: "press",
      preventDefault: true,
      held: true,
    });
  });

  it("压着不放的重复事件不重复发 press，但继续拦住页面滚动", () => {
    expect(hotkeyDecision(facts({ repeat: true, held: true }))).toEqual({
      action: null,
      preventDefault: true,
      held: true,
    });
  });

  it("焦点在输入框里按下：不抢空格，也不记成按住", () => {
    expect(hotkeyDecision(facts({ editing: true }))).toEqual({
      action: null,
      preventDefault: false,
      held: false,
    });
  });

  it("按下过再松开：发 release，松开按住标记", () => {
    expect(hotkeyDecision(facts({ phase: "up", held: true }))).toEqual({
      action: "release",
      preventDefault: true,
      held: false,
    });
  });

  it("没按住过的松开（比如按下时焦点在输入框）：不发 release", () => {
    expect(hotkeyDecision(facts({ phase: "up", held: false }))).toEqual({
      action: null,
      preventDefault: false,
      held: false,
    });
  });

  it("焦点在按下之后跑进输入框：松手照样发 release，录音不能停不下来", () => {
    const decision = hotkeyDecision(facts({ phase: "up", held: true, editing: true }));

    expect(decision.action).toBe("release");
    expect(decision.held).toBe(false);
  });

  it("不是配置的键：什么都不发，按住状态原样保留", () => {
    expect(hotkeyDecision(facts({ code: "KeyA", key: "a", held: true }))).toEqual({
      action: null,
      preventDefault: false,
      held: true,
    });
  });
});

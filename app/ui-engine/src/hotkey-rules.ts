/**
 * 快捷键的纯规则：认不认这个键、要不要抢、按下还是松开。
 *
 * 事件监听本身只能在浏览器里跑，但"哪一下算数"是纯判定——搬到这儿就能测。
 */

/**
 * 这个键是不是配置的那个。
 *
 * key 用 KeyboardEvent.code 的小写（"space" / "keyr"）；也接受 event.key 的小写，
 * 方便没有 code 的环境。空配置永远不匹配。
 */
export function keyMatches(configured: string, code: string, key: string): boolean {
  const wanted = configured.trim().toLowerCase();
  if (wanted.length === 0) {
    return false;
  }
  return code.toLowerCase() === wanted || key.toLowerCase() === wanted;
}

/**
 * 焦点是不是在可编辑控件里。
 *
 * 在那里打字时快捷键不该抢：空格是空格，不是"开始录"。
 */
export function isTypingTarget(target: unknown): boolean {
  if (typeof target !== "object" || target === null) {
    return false;
  }
  const record = target as { tagName?: unknown; isContentEditable?: unknown };
  const tag = typeof record.tagName === "string" ? record.tagName.toUpperCase() : "";
  if (tag === "INPUT" || tag === "TEXTAREA") {
    return true;
  }
  return record.isContentEditable === true;
}

export interface HotkeyFacts {
  /** 节点上配置的键 */
  configured: string;
  code: string;
  key: string;
  /** 长按产生的重复事件（压着不放只该触发一次） */
  repeat: boolean;
  /** 焦点在输入框里 */
  editing: boolean;
  /** 这个键当前算不算被我们按住了 */
  held: boolean;
  /** 事件阶段：按下还是松开 */
  phase: "down" | "up";
}

export interface HotkeyDecision {
  /** 要发的事件；null 表示什么都不发 */
  action: "press" | "release" | null;
  /** 要不要拦掉浏览器默认行为（空格滚动页面） */
  preventDefault: boolean;
  /** 这个键之后算不算被我们按住 */
  held: boolean;
}

/**
 * 一次键盘事件该怎么办。
 *
 * - 不是配置的键：不碰。
 * - 在输入框里按下：不抢、也不记成按住（否则松手会凭空发一次 release）。
 * - 压着不放的重复事件：不重复发 press，但仍然拦住页面滚动。
 * - 松开：只有我们真按住过才发 release；焦点这时在输入框里也得发——
 *   录音已经在跑了，不能因为焦点跑了就停不下来。
 */
export function hotkeyDecision(facts: HotkeyFacts): HotkeyDecision {
  const miss: HotkeyDecision = {
    action: null,
    preventDefault: false,
    held: facts.held,
  };
  if (!keyMatches(facts.configured, facts.code, facts.key)) {
    return miss;
  }
  if (facts.phase === "down") {
    if (facts.editing) {
      return miss;
    }
    if (facts.repeat) {
      return { action: null, preventDefault: true, held: facts.held };
    }
    return { action: "press", preventDefault: true, held: true };
  }
  if (!facts.held) {
    return miss;
  }
  return { action: "release", preventDefault: true, held: false };
}

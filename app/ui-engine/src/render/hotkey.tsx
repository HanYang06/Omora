import { useEffect, useRef, type ReactNode } from "react";
import { hotkeyDecision, isTypingTarget } from "./hotkey-rules";
import { prop, type NodeComponentProps } from "../core/shared";

/**
 * hotkey：不画任何东西，只在 document 上挂键盘监听。
 *
 * 按下发 on_press、松开发 on_release；焦点在输入框里时不抢。
 * handler id 每次都从 ref 取最新的一份——重画之后 id 会换，
 * 松手必须用新 id，不能抱着按下那一刻的旧 id 发。
 */
export function Hotkey({ node, onEvent }: NodeComponentProps): ReactNode {
  const key = prop(node, "key") ?? "";
  const onPress = prop(node, "on_press");
  const onRelease = prop(node, "on_release");
  /** 监听只挂一次，handler 从这儿取最新值。 */
  const latest = useRef({ key, onPress, onRelease, onEvent });
  const held = useRef(false);

  useEffect(() => {
    latest.current = { key, onPress, onRelease, onEvent };
  }, [key, onPress, onRelease, onEvent]);

  useEffect(() => {
    const handle = (phase: "down" | "up") => (event: KeyboardEvent): void => {
      const current = latest.current;
      const decision = hotkeyDecision({
        configured: current.key,
        code: event.code,
        key: event.key,
        repeat: event.repeat,
        editing: isTypingTarget(event.target),
        held: held.current,
        phase,
      });
      if (decision.preventDefault) {
        event.preventDefault();
      }
      held.current = decision.held;
      if (decision.action === null) {
        return;
      }
      const handler = decision.action === "press" ? current.onPress : current.onRelease;
      if (handler === undefined || handler.length === 0) {
        return;
      }
      current.onEvent?.(handler, {});
    };
    const onDown = handle("down");
    const onUp = handle("up");
    document.addEventListener("keydown", onDown);
    document.addEventListener("keyup", onUp);
    return () => {
      document.removeEventListener("keydown", onDown);
      document.removeEventListener("keyup", onUp);
    };
  }, []);

  return null;
}

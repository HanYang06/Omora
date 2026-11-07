import type { C3Node, UiSnapshot } from "../contract";
import type { BindingScope } from "../renderer/binding";

export const SLOT_NAMES = ["sidebar", "main"] as const;

export type SlotName = (typeof SLOT_NAMES)[number];

/** 命令条目直接取自快照的 ui.commands 形状，壳不重新定义协议。 */
export type ShellCommand = NonNullable<UiSnapshot["commands"]>[number];

export type ConnectionStatus = "connecting" | "online" | "reconnecting" | "closed";

export interface SlotContribution {
  nodes: readonly C3Node[];
  scope?: BindingScope;
}

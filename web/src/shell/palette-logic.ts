import type { CmdInvokeParams } from "../contract";
import type { ShellCommand } from "./types";

export interface PaletteState {
  readonly query: string;
  readonly selected: number;
}

export interface PaletteOutcome {
  readonly state: PaletteState;
  readonly handled: boolean;
  readonly close: boolean;
  readonly invoke: CmdInvokeParams | null;
}

export interface ShortcutEvent {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
}

export const INITIAL_PALETTE_STATE: PaletteState = { query: "", selected: 0 };

export function filterCommands(
  commands: readonly ShellCommand[],
  query: string,
): readonly ShellCommand[] {
  const terms = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length > 0);
  if (terms.length === 0) {
    return commands;
  }
  return commands.filter((command) => {
    const title = command.title.toLowerCase();
    return terms.every((term) => title.includes(term));
  });
}

export function clampSelection(selected: number, count: number): number {
  if (count <= 0) {
    return 0;
  }
  return Math.min(Math.max(selected, 0), count - 1);
}

export function moveSelection(selected: number, delta: number, count: number): number {
  if (count <= 0) {
    return 0;
  }
  return (((selected + delta) % count) + count) % count;
}

export function isPaletteShortcut(event: ShortcutEvent): boolean {
  return (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k";
}

export function handlePaletteKey(
  commands: readonly ShellCommand[],
  state: PaletteState,
  key: string,
): PaletteOutcome {
  const filtered = filterCommands(commands, state.query);
  const active = clampSelection(state.selected, filtered.length);

  if (key === "Escape") {
    return { state, handled: true, close: true, invoke: null };
  }
  if (key === "ArrowDown") {
    return {
      state: { ...state, selected: moveSelection(active, 1, filtered.length) },
      handled: true,
      close: false,
      invoke: null,
    };
  }
  if (key === "ArrowUp") {
    return {
      state: { ...state, selected: moveSelection(active, -1, filtered.length) },
      handled: true,
      close: false,
      invoke: null,
    };
  }
  if (key !== "Enter") {
    return { state, handled: false, close: false, invoke: null };
  }
  const command = filtered[active];
  if (command === undefined) {
    return { state, handled: false, close: false, invoke: null };
  }
  return {
    state: { ...state, selected: active },
    handled: true,
    close: true,
    invoke: { name: command.id },
  };
}

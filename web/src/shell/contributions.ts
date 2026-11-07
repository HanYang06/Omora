import type { C3Node, UiSnapshot } from "../contract";
import { isRecord } from "../lib/guards";
import type { BindingScope } from "../renderer/binding";
import { SLOT_NAMES, type SlotContribution, type SlotName } from "./shell";

export function contributionsFromUi(
  ui: UiSnapshot,
  state: Record<string, unknown>,
): Partial<Record<SlotName, readonly SlotContribution[]>> {
  const contributions: Partial<Record<SlotName, SlotContribution[]>> = {};
  for (const slot of SLOT_NAMES) {
    const entries = ui.slots[slot];
    if (entries === undefined) {
      continue;
    }
    contributions[slot] = entries.map((entry) => ({
      nodes: toNodes(entry.nodes),
      scope: scopeForOwner(state, entry.owner),
    }));
  }
  return contributions;
}

function scopeForOwner(state: Record<string, unknown>, owner: string): BindingScope {
  const slice = state[owner];
  return isRecord(slice) ? slice : {};
}

function toNodes(nodes: readonly Record<string, unknown>[]): readonly C3Node[] {
  return nodes as unknown as readonly C3Node[];
}

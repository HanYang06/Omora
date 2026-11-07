import type { Notification, SnapshotResult, UiSnapshot } from "../contract";

export type C1Event = Notification["params"];

export interface Projection {
  readonly revision: number;
  readonly state: Record<string, unknown>;
  readonly ui: UiSnapshot;
  readonly events: readonly C1Event[];
}

export type ApplyStatus = "applied" | "duplicate" | "gap";

export interface ApplyResult {
  readonly status: ApplyStatus;
  readonly projection: Projection;
}

export function emptyProjection(): Projection {
  return { revision: 0, state: {}, ui: { slots: {} }, events: [] };
}

export function fromSnapshot(snapshot: SnapshotResult): Projection {
  return { revision: snapshot.revision, state: snapshot.state, ui: snapshot.ui, events: [] };
}

export function applyEvent(projection: Projection, event: C1Event): ApplyResult {
  if (event.revision <= projection.revision) {
    return { status: "duplicate", projection };
  }
  if (event.revision > projection.revision + 1) {
    return { status: "gap", projection };
  }
  const next: Projection = {
    revision: event.revision,
    state: applySliceUpdates(projection.state, event),
    ui: projection.ui,
    events: [...projection.events, event],
  };
  return { status: "applied", projection: next };
}

function applySliceUpdates(
  state: Record<string, unknown>,
  event: C1Event,
): Record<string, unknown> {
  const updates = event.updates;
  if (updates === undefined || updates.length === 0) {
    return state;
  }
  const next: Record<string, unknown> = { ...state };
  for (const update of updates) {
    next[update.owner] = update.state;
  }
  return next;
}

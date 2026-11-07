import { describe, expect, it } from "vitest";

import type { SnapshotResult } from "../src/contract";
import { applyEvent, fromSnapshot, type C1Event } from "../src/store/projection";

function snapshot(revision: number): SnapshotResult {
  return { revision, state: { "plugin.a": { items: ["x"] } }, ui: { slots: {} } };
}

function event(revision: number): C1Event {
  return { type: "state.changed", revision, data: { revision } };
}

describe("projection revision handling", () => {
  it("carries the ui snapshot into the projection", () => {
    const ui = { slots: { main: [{ owner: "plugin.a", nodes: [] }] } };

    const projection = fromSnapshot({ revision: 2, state: {}, ui });

    expect(projection.ui).toBe(ui);
  });

  it("replaces only the owner slice when a live event carries the folded slice", () => {
    const base = fromSnapshot(snapshot(3));
    const slice = { items: ["y"] };

    const result = applyEvent(base, {
      type: "state.changed",
      revision: 4,
      data: { id: "y" },
      owner: "plugin.a",
      state: slice,
    });

    expect(result.status).toBe("applied");
    expect(result.projection.state["plugin.a"]).toBe(slice);
    expect(result.projection.state["plugin.b"]).toBe(base.state["plugin.b"]);
  });

  it("advances revision without touching state for catch-up events", () => {
    const base = fromSnapshot(snapshot(3));

    const result = applyEvent(base, { type: "state.changed", revision: 4, data: { id: "y" } });

    expect(result.status).toBe("applied");
    expect(result.projection.state).toBe(base.state);
    expect(result.projection.revision).toBe(4);
  });

  it("applies the next revision and keeps the snapshot state", () => {
    const base = fromSnapshot(snapshot(3));

    const result = applyEvent(base, event(4));

    expect(result.status).toBe("applied");
    expect(result.projection.revision).toBe(4);
    expect(result.projection.state).toBe(base.state);
    expect(result.projection.events).toHaveLength(1);
  });

  it("drops out-of-order events without changing the projection", () => {
    const base = fromSnapshot(snapshot(3));

    const result = applyEvent(base, event(2));

    expect(result.status).toBe("duplicate");
    expect(result.projection).toBe(base);
  });

  it("does not change the projection when the same revision is pushed twice", () => {
    const base = fromSnapshot(snapshot(3));
    const first = applyEvent(base, event(4));

    const second = applyEvent(first.projection, event(4));

    expect(second.status).toBe("duplicate");
    expect(second.projection).toBe(first.projection);
    expect(second.projection.events).toHaveLength(1);
  });

  it("reports a gap when a revision is missing", () => {
    const base = fromSnapshot(snapshot(3));

    const result = applyEvent(base, event(5));

    expect(result.status).toBe("gap");
    expect(result.projection).toBe(base);
    expect(result.projection.revision).toBe(3);
  });
});

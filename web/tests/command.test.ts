import { describe, expect, it } from "vitest";

import { resolveCommand } from "../src/renderer/command";

describe("command resolution", () => {
  it("turns a click declaration into a command with resolved arguments", () => {
    const command = resolveCommand(
      { command: "sample.open", args: { id: "$item.id", mode: "keep", pinned: true } },
      { item: { id: "a1" } },
    );

    expect(command).toEqual({
      name: "sample.open",
      args: { id: "a1", mode: "keep", pinned: true },
    });
  });

  it("omits arguments whose binding cannot be resolved", () => {
    const command = resolveCommand({ command: "sample.open", args: { id: "$missing" } }, {});

    expect(command).toEqual({ name: "sample.open", args: {} });
  });

  it("returns null when the node declares no command", () => {
    expect(resolveCommand(undefined, {})).toBeNull();
  });
});

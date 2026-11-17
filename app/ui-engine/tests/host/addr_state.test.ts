import { describe, expect, it } from "vitest";
import type { SlotNode } from "../../src/contract/document";
import { AddrState } from "../../src/host/addr_state";

function chain(count: number): SlotNode {
  const children = Array.from({ length: count }, (_, index) => ({
    id: "n" + String(index),
    kind: "dendro:text",
    owner: "test",
    props: {},
    addr: "new-" + String(index),
    children: [],
  }));
  return {
    id: "root",
    kind: "dendro:window",
    owner: "test",
    props: {},
    addr: "root-addr",
    children,
  };
}

describe("AddrState：redirect 表容量", () => {
  it("超过上限后淘汰最旧写入，最近的旧 addr 仍可解析", () => {
    const root = chain(300);
    const oldAddrs = new Map<string, string>();
    for (let index = 0; index < 300; index += 1) {
      oldAddrs.set("old-" + String(index), "n" + String(index));
    }

    const state = new AddrState();
    state.note(root, oldAddrs, []);

    expect(state.resolve("old-0", root)).toBeUndefined();
    expect(state.resolve("old-299", root)?.id).toBe("n299");
    expect(state.resolve("new-0", root)?.id).toBe("n0");
  });
});

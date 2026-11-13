import { describe, expect, it } from "vitest";
import type { SlotNode } from "../contract/document";
import { link } from "./link";
import { WINDOW_SCAFFOLD } from "./scaffold";
import type { Diagnostic, DiagnosticCode } from "./types";
import { fixturePayload, payloadOf, slot, tree } from "./test_fixtures";

function diagnosticsOf(payload: unknown, base: SlotNode = WINDOW_SCAFFOLD): Diagnostic[] {
  const result = link(base, payload);
  expect(result.ok).toBe(false);
  if (result.ok) {
    return [];
  }
  return result.diagnostics;
}

function codesOf(payload: unknown, base: SlotNode = WINDOW_SCAFFOLD): DiagnosticCode[] {
  return diagnosticsOf(payload, base).map((diagnostic) => diagnostic.code);
}

function findDiagnostic(
  diagnostics: readonly Diagnostic[],
  code: DiagnosticCode,
): Diagnostic | undefined {
  return diagnostics.find((diagnostic) => diagnostic.code === code);
}

describe("link：每个诊断码都有一条失败路径", () => {
  it("E-SLOT-AMBIGUOUS：同 slot 不同 owner 的 order 相同，消息写出双方与 order", () => {
    const payload = structuredClone(fixturePayload());
    const audioMount = payload.trees[3];
    if (audioMount === undefined) {
      throw new Error("fixture 少了 audio 挂载树");
    }
    audioMount.order = 20;

    const diagnostics = diagnosticsOf(payload);
    const ambiguous = findDiagnostic(diagnostics, "E-SLOT-AMBIGUOUS");

    expect(ambiguous).toBeDefined();
    expect(ambiguous?.slot).toBe("ideas.feed");
    expect(ambiguous?.message).toContain("ideas");
    expect(ambiguous?.message).toContain("audio");
    expect(ambiguous?.message).toContain("20");
    expect(codesOf(payload)).not.toContain("E-SLOT-CAPACITY");
  });

  it("E-SLOT-AMBIGUOUS：诊断与到达顺序无关", () => {
    const payload = structuredClone(fixturePayload());
    const audioMount = payload.trees[3];
    if (audioMount === undefined) {
      throw new Error("fixture 少了 audio 挂载树");
    }
    audioMount.order = 20;

    const forward = diagnosticsOf(payload);
    const backward = diagnosticsOf(payloadOf([...payload.trees].reverse(), payload.seq));

    expect(backward).toEqual(forward);
  });

  it("E-SLOT-CAPACITY：capacity one 的 slot 被两个挂载填", () => {
    const payload = payloadOf([
      tree({
        owner: "a",
        mountAt: "dendro.window.page",
        order: 10,
        root: slot({ id: "a.page", owner: "a" }),
      }),
      tree({
        owner: "b",
        mountAt: "dendro.window.page",
        order: 20,
        root: slot({ id: "b.page", owner: "b" }),
      }),
    ]);

    const capacity = findDiagnostic(diagnosticsOf(payload), "E-SLOT-CAPACITY");

    expect(capacity?.slot).toBe("dendro.window.page");
    expect(capacity?.message).toContain("one");
    expect(capacity?.message).toContain("2");
  });

  it("E-SLOT-CAPACITY：capacity none 的容器被挂上子节点", () => {
    const base = slot({ id: "root", layout: { flow: "column", capacity: "none" } });

    const diagnostics = diagnosticsOf(
      payloadOf([tree({ mountAt: "root", root: slot({ id: "child" }) })]),
      base,
    );

    expect(findDiagnostic(diagnostics, "E-SLOT-CAPACITY")?.slot).toBe("root");
  });

  it("E-SLOT-CAPACITY：replace 不能与同槽其他挂载共存", () => {
    const base = slot({
      id: "root",
      layout: { flow: "column", capacity: "many" },
      children: [slot({ id: "root.area", layout: { flow: "column", capacity: "many" } })],
    });
    const payload = payloadOf([
      tree({
        owner: "a",
        mountAt: "root.area",
        order: 10,
        replace: true,
        root: slot({ id: "a.node", owner: "a" }),
      }),
      tree({
        owner: "b",
        mountAt: "root.area",
        order: 20,
        root: slot({ id: "b.node", owner: "b" }),
      }),
    ]);

    const conflict = findDiagnostic(diagnosticsOf(payload, base), "E-SLOT-CAPACITY");

    expect(conflict?.slot).toBe("root.area");
    expect(conflict?.message).toContain("replace");
  });

  it("E-TARGET-MISSING：落点在整个输入里都不存在", () => {
    const diagnostics = diagnosticsOf(
      payloadOf([
        tree({ owner: "a", mountAt: "ghost.slot", root: slot({ id: "a.node", owner: "a" }) }),
      ]),
    );
    const missing = findDiagnostic(diagnostics, "E-TARGET-MISSING");

    expect(missing?.owner).toBe("a");
    expect(missing?.slot).toBe("ghost.slot");
    expect(missing?.message).toContain("ghost.slot");
  });

  it("E-TARGET-MISSING：依赖的落点最终没挂上（多轮后仍落不下）", () => {
    const payload = payloadOf([
      tree({
        owner: "a",
        order: 10,
        mountAt: "ghost.slot",
        root: slot({
          id: "a.root",
          owner: "a",
          children: [slot({ id: "a.slot", owner: "a" })],
        }),
      }),
      tree({ owner: "b", order: 20, mountAt: "a.slot", root: slot({ id: "b.root", owner: "b" }) }),
    ]);

    const diagnostics = diagnosticsOf(payload);
    const dependent = diagnostics.find(
      (diagnostic) => diagnostic.code === "E-TARGET-MISSING" && diagnostic.owner === "b",
    );

    expect(dependent).toBeDefined();
    expect(dependent?.message).toContain("多轮");
  });

  it("E-CYCLE：局部树挂在自己子树里的 slot 上", () => {
    const root = slot({
      id: "c.root",
      owner: "c",
      children: [slot({ id: "c.slot", owner: "c" })],
    });

    const cycle = findDiagnostic(
      diagnosticsOf(payloadOf([tree({ owner: "c", mountAt: "c.slot", root })])),
      "E-CYCLE",
    );

    expect(cycle?.owner).toBe("c");
    expect(cycle?.slot).toBe("c.slot");
    expect(cycle?.message).toContain("自己子树");
  });

  it("E-CYCLE：局部树之间依赖成环", () => {
    const payload = payloadOf([
      tree({
        owner: "a",
        order: 10,
        mountAt: "b.slot",
        root: slot({ id: "a.root", owner: "a", children: [slot({ id: "a.slot", owner: "a" })] }),
      }),
      tree({
        owner: "b",
        order: 20,
        mountAt: "a.slot",
        root: slot({ id: "b.root", owner: "b", children: [slot({ id: "b.slot", owner: "b" })] }),
      }),
    ]);

    const cycles = diagnosticsOf(payload).filter((diagnostic) => diagnostic.code === "E-CYCLE");

    expect(cycles.map((diagnostic) => diagnostic.owner).sort()).toEqual(["a", "b"]);
  });

  it("E-ID-DUPLICATE：局部树 id 撞上窗口骨架的 id", () => {
    const duplicate = findDiagnostic(
      diagnosticsOf(
        payloadOf([tree({ owner: "x", root: slot({ id: "dendro.window.nav", owner: "x" }) })]),
      ),
      "E-ID-DUPLICATE",
    );

    expect(duplicate?.message).toContain("dendro.window.nav");
  });

  it("E-ID-DUPLICATE：跨树重复 id（link 复用了 parse 的校验）", () => {
    const payload = payloadOf([
      tree({ owner: "x", root: slot({ id: "dup", owner: "x" }) }),
      tree({ owner: "y", root: slot({ id: "dup", owner: "y" }) }),
    ]);

    expect(codesOf(payload)).toContain("E-ID-DUPLICATE");
  });

  it("E-PAYLOAD：payload 形状不合法", () => {
    expect(codesOf({ kind: "something-else", seq: 1, trees: [] })).toContain("E-PAYLOAD");
    expect(codesOf(null)).toContain("E-PAYLOAD");
  });

  it("E-PAYLOAD：base 形状不合法", () => {
    const base = { id: "root", kind: "dendro:slot" } as unknown as SlotNode;

    const result = link(base, payloadOf([]));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain("E-PAYLOAD");
    }
  });
});

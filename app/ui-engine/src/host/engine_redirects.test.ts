import { describe, expect, it } from "vitest";
import { createEngine, type EngineRuntime } from "./engine";

function leaf(id: string, text: string, addr?: string): Record<string, unknown> {
  return {
    id,
    kind: "dendro:text",
    owner: "test",
    props: { text },
    ...(addr === undefined ? {} : { addr }),
    children: [],
  };
}

function slot(id: string, addr: string, children: unknown[] = []): Record<string, unknown> {
  return {
    id,
    kind: "dendro:slot",
    owner: "test",
    props: {},
    addr,
    children,
  };
}

function documentOf(children: unknown[]): Record<string, unknown> {
  return {
    schema: "dendro.ui/1",
    version: 1,
    pages: [],
    active: "",
    data: {},
    document: {
      id: "root",
      kind: "dendro:window",
      owner: "test",
      props: {},
      addr: "root-addr",
      children,
    },
  };
}

function resolve(engine: EngineRuntime, addr: string) {
  return engine.addrs.resolve(addr, engine.session.document.root);
}

function engineOf(children: unknown[]): EngineRuntime {
  const created = createEngine(documentOf(children));
  if (!created.ok) {
    throw new Error("测试文档应能建引擎: " + JSON.stringify(created.diagnostics));
  }
  return created.engine;
}

describe("EngineRuntime：addr redirect / tombstone", () => {
  it("unmount 后旧 addr 是墓碑，其他 addr 不受影响", () => {
    const engine = engineOf([slot("left", "left-addr", [leaf("leaf", "x", "leaf-addr")])]);

    const applied = engine.applyOps({
      kind: "ops",
      document: 2,
      base: 1,
      seq: 1,
      ops: [{ op: "unmount", id: "leaf" }],
    });

    expect(applied.ok).toBe(true);
    expect(resolve(engine, "leaf-addr")).toBeUndefined();
    expect(resolve(engine, "left-addr")?.id).toBe("left");
    expect(resolve(engine, "root-addr")?.id).toBe("root");
    engine.dispose();
  });

  it("replace 后旧 addr 重定向到新节点", () => {
    const engine = engineOf([slot("left", "left-addr", [leaf("leaf", "x", "leaf-addr")])]);

    const applied = engine.applyOps({
      kind: "ops",
      document: 2,
      base: 1,
      seq: 1,
      ops: [
        {
          op: "replace",
          id: "leaf",
          node: leaf("leaf2", "y"),
        },
      ],
    });

    expect(applied.ok).toBe(true);
    expect(resolve(engine, "leaf-addr")?.id).toBe("leaf2");
    engine.dispose();
  });

  it("move 后旧 addr 仍解析到被移动的节点", () => {
    const engine = engineOf([
      slot("left", "left-addr", [leaf("leaf", "x", "leaf-addr")]),
      slot("right", "right-addr"),
    ]);

    const applied = engine.applyOps({
      kind: "ops",
      document: 2,
      base: 1,
      seq: 1,
      ops: [{ op: "move", id: "leaf", slot: "right", at: 0 }],
    });

    expect(applied.ok).toBe(true);
    expect(resolve(engine, "leaf-addr")?.id).toBe("leaf");
    engine.dispose();
  });

  it("全量替换清掉 redirect / 墓碑", () => {
    const engine = engineOf([slot("left", "left-addr", [leaf("leaf", "x", "leaf-addr")])]);
    engine.applyOps({
      kind: "ops",
      document: 2,
      base: 1,
      seq: 1,
      ops: [{ op: "unmount", id: "leaf" }],
    });
    expect(resolve(engine, "leaf-addr")).toBeUndefined();

    const next = documentOf([slot("left", "left-addr")]);
    next.version = 9;
    const full = engine.applyFull(next);

    expect(full.ok).toBe(true);
    expect(resolve(engine, "leaf-addr")).toBeUndefined();
    engine.dispose();
  });
});

// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { Document, Node } from "../../../src/contract/tree_generated";
import type {
  Kind,
  KindRegistry,
  Node as LegacyNode,
  RenderContext,
} from "../../../src/renderer/types";
import { mountTreeDocument } from "../../../src/app/tree/tree_renderer";

const ROOT = "aaaaaaaaaaaaaaaa";
const PAGE = "bbbbbbbbbbbbbbbb";
const A = "cccccccccccccccc";
const B = "dddddddddddddddd";

function node(
  id: string,
  chain: string,
  kind: string,
  order: number,
  over: Partial<Node> = {},
): Node {
  return {
    id,
    chain,
    kind,
    order,
    layout: [],
    settings: {},
    bind: {},
    on: {},
    emit: {},
    ...over,
  };
}

function text(id: string, order: number, value: string): Node {
  return node(id, ROOT + "." + PAGE + "." + id, "text", order, {
    settings: { text: value },
  });
}

function documentOf(version = 1): Document {
  return {
    schema: "dendro.tree/1",
    version,
    root: node(ROOT, ROOT, "app", 0, {
      layout: [
        node(PAGE, ROOT + "." + PAGE, "column", 10, {
          layout: [text(A, 10, "甲"), text(B, 20, "乙")],
        }),
      ],
    }),
    pages: [{ id: PAGE, title: "页", route: "/page" }],
    active: PAGE,
    data: {},
  };
}

interface Counters {
  created: number;
  updated: number;
  destroyed: number;
}

function countingKinds(counters: Counters): KindRegistry {
  const textOf = (legacy: LegacyNode): string => {
    const value = legacy.props.text;
    return typeof value === "string" ? value : "";
  };
  const textKind: Kind = {
    create(legacy) {
      counters.created += 1;
      const el = document.createElement("span");
      el.textContent = textOf(legacy);
      return el;
    },
    update(el, legacy) {
      counters.updated += 1;
      el.textContent = textOf(legacy);
    },
    destroy() {
      counters.destroyed += 1;
    },
  };
  const box: Kind = {
    create() {
      counters.created += 1;
      return document.createElement("div");
    },
  };
  return { app: box, column: box, text: textKind };
}

function context(): RenderContext {
  return {
    event: () => undefined,
    loadMedia: () => Promise.reject(new Error("测试不加载媒体")),
    cleanup: () => undefined,
  };
}

function mount(counters: Counters = { created: 0, updated: 0, destroyed: 0 }): {
  container: HTMLElement;
  runtime: ReturnType<typeof mountTreeDocument>;
  counters: Counters;
} {
  const container = document.createElement("div");
  document.body.append(container);
  const runtime = mountTreeDocument(container, documentOf(), context(), countingKinds(counters));
  return { container, runtime, counters };
}

function batch(base: number, document: number, ops: unknown[]): Record<string, unknown> {
  return { kind: "ops", base, document, seq: 1, ops };
}

describe("TreeRuntime.applyOps：内容更新", () => {
  it("setProps 只更新目标节点：元素复用、兄弟不动", () => {
    const { container, runtime, counters } = mount();
    const before = [...container.querySelectorAll("span")];
    expect(before.map((el) => el.textContent)).toEqual(["甲", "乙"]);

    const result = runtime.applyOps(
      batch(1, 2, [{ op: "setProps", id: A, props: { text: "甲改" } }]),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changed).toEqual([A]);
    const after = [...container.querySelectorAll("span")];
    expect(after[0]).toBe(before[0]);
    expect(after[1]).toBe(before[1]);
    expect(after[0]?.textContent).toBe("甲改");
    expect(after[1]?.textContent).toBe("乙");
    expect(counters).toEqual({ created: 4, updated: 1, destroyed: 0 });
    expect(runtime.document?.version).toBe(2);

    runtime.dispose();
    container.remove();
  });

  it("版本不一致：E-VERSION，DOM 不动", () => {
    const { container, runtime } = mount();

    const result = runtime.applyOps(
      batch(0, 1, [{ op: "setProps", id: A, props: { text: "甲改" } }]),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["E-PAYLOAD"]);
    expect(container.querySelector("span")?.textContent).toBe("甲");

    // 合法形状但 base 对不上：E-VERSION。
    const stale = runtime.applyOps(
      batch(1, 2, [{ op: "setProps", id: A, props: { text: "甲改" } }]),
    );
    expect(stale.ok).toBe(true);
    const again = runtime.applyOps(
      batch(1, 2, [{ op: "setProps", id: A, props: { text: "甲改" } }]),
    );
    expect(again.ok).toBe(false);
    if (!again.ok) {
      expect(again.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["E-VERSION"]);
    }

    runtime.dispose();
    container.remove();
  });

  it("mount：只挂一棵新子树，兄弟引用不变", () => {
    const { container, runtime, counters } = mount();
    const before = [...container.querySelectorAll("span")];
    const C = "eeeeeeeeeeeeeeee";
    const mountOp = {
      op: "mount",
      parent: PAGE,
      node: node(C, ROOT + "." + PAGE + "." + C, "text", 15, { settings: { text: "丙" } }),
    };

    const result = runtime.applyOps(batch(1, 2, [mountOp]));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const after = [...container.querySelectorAll("span")];
    expect(after.map((el) => el.textContent)).toEqual(["甲", "丙", "乙"]);
    expect(after[0]).toBe(before[0]);
    expect(after[2]).toBe(before[1]);
    expect(counters).toEqual({ created: 5, updated: 0, destroyed: 0 });
    expect(runtime.document?.version).toBe(2);

    runtime.dispose();
    container.remove();
  });

  it("unmount：只摘目标子树，剩下的不动", () => {
    const { container, runtime, counters } = mount();
    const before = [...container.querySelectorAll("span")];

    const result = runtime.applyOps(batch(1, 2, [{ op: "unmount", id: B }]));

    expect(result.ok).toBe(true);
    const after = [...container.querySelectorAll("span")];
    expect(after.map((el) => el.textContent)).toEqual(["甲"]);
    expect(after[0]).toBe(before[0]);
    expect(counters.destroyed).toBe(1);

    runtime.dispose();
    container.remove();
  });

  it("同一批里摘一棵、挂一棵：只动这两棵", () => {
    const { container, runtime, counters } = mount();
    const C = "eeeeeeeeeeeeeeee";
    const ops = [
      { op: "unmount", id: B },
      {
        op: "mount",
        parent: PAGE,
        node: node(C, ROOT + "." + PAGE + "." + C, "text", 15, { settings: { text: "丙" } }),
      },
    ];

    const result = runtime.applyOps(batch(1, 2, ops));

    expect(result.ok).toBe(true);
    expect([...container.querySelectorAll("span")].map((el) => el.textContent)).toEqual([
      "甲",
      "丙",
    ]);
    expect(counters).toEqual({ created: 5, updated: 0, destroyed: 1 });

    runtime.dispose();
    container.remove();
  });

  it("replace 同 id：换一棵子树，兄弟不动", () => {
    const { container, runtime, counters } = mount();
    const before = [...container.querySelectorAll("span")];
    const replaceOp = {
      op: "replace",
      id: A,
      node: node(A, ROOT + "." + PAGE + "." + A, "text", 10, { settings: { text: "新" } }),
    };

    const result = runtime.applyOps(batch(1, 2, [replaceOp]));

    expect(result.ok).toBe(true);
    const after = [...container.querySelectorAll("span")];
    expect(after.map((el) => el.textContent)).toEqual(["新", "乙"]);
    expect(after[0]).not.toBe(before[0]);
    expect(after[1]).toBe(before[1]);
    expect(counters).toEqual({ created: 5, updated: 0, destroyed: 1 });

    runtime.dispose();
    container.remove();
  });

  it("replace 换 id：旧子树摘掉、新子树放到同一个父下", () => {
    const { container, runtime } = mount();
    const E = "eeeeeeeeeeeeeeee";
    const replaceOp = {
      op: "replace",
      id: B,
      node: node(E, ROOT + "." + PAGE + "." + E, "text", 20, { settings: { text: "换" } }),
    };

    const result = runtime.applyOps(batch(1, 2, [replaceOp]));

    expect(result.ok).toBe(true);
    expect([...container.querySelectorAll("span")].map((el) => el.textContent)).toEqual([
      "甲",
      "换",
    ]);

    runtime.dispose();
    container.remove();
  });

  it("replace + setProps 同一批：用最终节点的内容", () => {
    const { container, runtime, counters } = mount();
    const ops = [
      {
        op: "replace",
        id: A,
        node: node(A, ROOT + "." + PAGE + "." + A, "text", 10, { settings: { text: "一" } }),
      },
      { op: "setProps", id: A, props: { text: "二" } },
    ];

    const result = runtime.applyOps(batch(1, 2, ops));

    expect(result.ok).toBe(true);
    expect([...container.querySelectorAll("span")].map((el) => el.textContent)).toEqual([
      "二",
      "乙",
    ]);
    expect(counters.created).toBe(5);

    runtime.dispose();
    container.remove();
  });

  it("一次批量多个 replace：整批拒绝", () => {
    const { container, runtime } = mount();
    const ops = [
      {
        op: "replace",
        id: A,
        node: node(A, ROOT + "." + PAGE + "." + A, "text", 10, { settings: { text: "一" } }),
      },
      {
        op: "replace",
        id: B,
        node: node(B, ROOT + "." + PAGE + "." + B, "text", 20, { settings: { text: "二" } }),
      },
    ];

    const result = runtime.applyOps(batch(1, 2, ops));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["E-PAYLOAD"]);
    }

    runtime.dispose();
    container.remove();
  });

  it("批量里有一个失败：整批不生效，DOM 不动", () => {
    const { container, runtime, counters } = mount();

    const result = runtime.applyOps(
      batch(1, 2, [
        { op: "setProps", id: A, props: { text: "甲改" } },
        { op: "setProps", id: "ffffffffffffffff", props: { text: "没有" } },
      ]),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain("E-TARGET-MISSING");
    }
    expect(counters.updated).toBe(0);
    expect(container.querySelector("span")?.textContent).toBe("甲");
    expect(runtime.document?.version).toBe(1);

    runtime.dispose();
    container.remove();
  });

  it("没挂载时 applyOps：E-TREE-STATE", () => {
    const { container, runtime } = mount();
    runtime.unmount();

    const result = runtime.applyOps(
      batch(1, 2, [{ op: "setProps", id: A, props: { text: "甲改" } }]),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["E-TREE-STATE"]);
    }
    container.remove();
  });
});

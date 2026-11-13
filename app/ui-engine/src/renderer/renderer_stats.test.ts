// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import type { Node } from "./types";
import { DomRenderer } from "./renderer";
import type { Kind, KindRegistry, RenderContext } from "./types";

/**
 * 渲染节点统计的行为测试：created / updated / reused / removed 只描述最近一次 render，
 * 每次 render 重置；计数不改协调语义（元素复用、跨父 move、清理仍按旧规则）。
 */

function probeNode(id: string, children: Node[] = []): Node {
  return { type: "probe", id, props: {}, children };
}

function plainNode(id: string, children: Node[] = []): Node {
  return { type: "plain", id, props: {}, children };
}

function sinkNode(id: string, children: Node[] = []): Node {
  return { type: "sink", id, props: {}, children };
}

function mark(node: Node, log: string[], action: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "probe";
  el.dataset.type = node.type;
  el.dataset.probe = node.id ?? "";
  log.push(action + ":" + (node.id ?? ""));
  return el;
}

/** 可观测的 kind：create / update / destroy 都记账；sink 自己消费 children（不挂载）。 */
function probeKind(log: string[]): Kind {
  return {
    create(node) {
      return mark(node, log, "create");
    },
    update(el, node) {
      el.dataset.probe = node.id ?? "";
      log.push("update:" + (node.id ?? ""));
    },
    destroy(el) {
      log.push("destroy:" + (el.dataset.probe ?? ""));
    },
  };
}

/** 没有 update 的 kind：同 key 同 type 只能复用，没有更新动作。 */
function plainKind(log: string[]): Kind {
  return {
    create(node) {
      return mark(node, log, "create");
    },
    destroy(el) {
      log.push("destroy:" + (el.dataset.probe ?? ""));
    },
  };
}

/** childrenHosts 返回 null：kind 自己消费 children 数据，renderer 不建子条目。 */
function sinkKind(log: string[]): Kind {
  return {
    create(node) {
      return mark(node, log, "create");
    },
    childrenHosts: () => null,
  };
}

function kinds(log: string[] = []): KindRegistry {
  return { probe: probeKind(log), plain: plainKind(log), sink: sinkKind(log) };
}

interface Harness {
  container: HTMLElement;
  renderer: DomRenderer;
  render(node: Node): void;
}

const open: Harness[] = [];

function harness(registry: KindRegistry = kinds()): Harness {
  const context: RenderContext = {
    event: () => undefined,
    loadMedia: () => Promise.resolve({ mime: "", data: "" }),
    cleanup: () => undefined,
  };
  const container = document.createElement("div");
  document.body.append(container);
  const renderer = new DomRenderer({ registry, context });
  const mounted: Harness = {
    container,
    renderer,
    render: (node) => renderer.render(node, container),
  };
  open.push(mounted);
  return mounted;
}

afterEach(() => {
  for (const mounted of open.splice(0)) {
    mounted.renderer.dispose();
    mounted.container.remove();
  }
});

function elOf(container: HTMLElement, id: string): HTMLElement | null {
  return container.querySelector<HTMLElement>('[data-probe="' + id + '"]');
}

describe("RenderStats：每次 render 的节点统计", () => {
  it("首帧按节点数记 created；整棵同一引用重渲染时 reused = 节点数、其余为 0", () => {
    const h = harness();
    const a = probeNode("a");
    const b = probeNode("b", [probeNode("c")]);
    const tree = probeNode("root", [a, b]);

    h.render(tree);
    expect(h.renderer.stats).toEqual({ created: 4, updated: 0, reused: 0, removed: 0 });

    // 同一个根 node 引用：整棵树按 memo 跳过，不遍历；每个条目都算复用。
    h.render(tree);
    expect(h.renderer.stats).toEqual({ created: 0, updated: 0, reused: 4, removed: 0 });

    // 新根对象、子节点引用全不变：根调 update（计入 updated，也是 reused 的子集），
    // a 与 b+c 两棵未变子树整棵跳过，但同样计入 reused。
    h.render(probeNode("root", [a, b]));
    expect(h.renderer.stats).toEqual({ created: 0, updated: 1, reused: 4, removed: 0 });
  });

  it("新节点对象按 key 复用：每个条目都调 kind.update，记 updated", () => {
    const h = harness();
    h.render(probeNode("root", [probeNode("a"), probeNode("b")]));

    h.render(probeNode("root", [probeNode("a"), probeNode("b")]));

    // 三个条目都复用并调了 update：updated 是 reused 的子集。
    expect(h.renderer.stats).toEqual({ created: 0, updated: 3, reused: 3, removed: 0 });
    expect(elOf(h.container, "root")?.children).toHaveLength(2);
  });

  it("created + reused = 本次树条目数，updated 只是 reused 的子集", () => {
    const h = harness();
    const kept = probeNode("kept");
    h.render(probeNode("root", [kept]));

    h.render(probeNode("root", [kept, probeNode("fresh")]));

    const stats = h.renderer.stats;
    expect(stats).toEqual({ created: 1, updated: 1, reused: 2, removed: 0 });
    expect(stats.created + stats.reused).toBe(3);
    expect(stats.updated).toBeLessThanOrEqual(stats.reused);
  });

  it("kind 没有 update：元素复用但无更新动作，记 reused", () => {
    const h = harness();
    h.render(plainNode("root", [plainNode("a")]));

    h.render(plainNode("root", [plainNode("a")]));

    expect(h.renderer.stats).toEqual({ created: 0, updated: 0, reused: 2, removed: 0 });
  });

  it("跨父 move：元素复用，移动的子树记 reused；换父不销毁", () => {
    const log: string[] = [];
    const h = harness(kinds(log));
    const leaf = probeNode("leaf");
    h.render(probeNode("root", [probeNode("left", [leaf]), probeNode("right")]));
    const before = elOf(h.container, "leaf");
    log.length = 0;

    h.render(probeNode("root", [probeNode("left"), probeNode("right", [leaf])]));

    // root / left / right 更新（计入 updated，也是 reused 的子集）；leaf 跨父 move 后整棵复用。
    expect(h.renderer.stats).toEqual({ created: 0, updated: 3, reused: 4, removed: 0 });
    expect(elOf(h.container, "leaf")).toBe(before);
    expect(log.filter((entry) => entry.startsWith("destroy"))).toEqual([]);
  });

  it("节点消失：整棵旧子树都记 removed，保留的条目记 reused", () => {
    const h = harness();
    const kept = probeNode("a");
    h.render(probeNode("root", [kept, probeNode("b", [probeNode("c")])]));

    h.render(probeNode("root", [kept]));

    // 根 update、保留的 a 整棵跳过（都计入 reused）；b / c 两个旧条目销毁。
    expect(h.renderer.stats).toEqual({ created: 0, updated: 1, reused: 2, removed: 2 });
    expect(elOf(h.container, "b")).toBeNull();
  });

  it("换根：旧树整棵弃用记 removed，新树按新建记 created", () => {
    const h = harness();
    h.render(probeNode("root", [probeNode("a")]));

    h.render(probeNode("other", [probeNode("b")]));

    expect(h.renderer.stats).toEqual({ created: 2, updated: 0, reused: 0, removed: 2 });
    expect(elOf(h.container, "root")).toBeNull();
    expect(elOf(h.container, "other")).not.toBeNull();
  });

  it("childrenHosts 为空：子树不建条目；之后能挂载时按新建计", () => {
    const h = harness();
    const hidden = probeNode("hidden");

    // sink 不挂载 children：hidden 没有条目，created 只有 sink 自己。
    h.render(sinkNode("sink", [hidden]));
    expect(h.renderer.stats).toEqual({ created: 1, updated: 0, reused: 0, removed: 0 });
    expect(elOf(h.container, "hidden")).toBeNull();

    // 换根到普通容器：旧 sink 销毁，root + hidden 新建。
    h.render(probeNode("root", [hidden]));
    expect(h.renderer.stats).toEqual({ created: 2, updated: 0, reused: 0, removed: 1 });
    expect(elOf(h.container, "hidden")).not.toBeNull();
  });

  it("未知 kind 画占位，占位也按新建计数", () => {
    const h = harness();
    const unknown: Node = { type: "nope", id: "u", props: {}, children: [probeNode("child")] };

    h.render(unknown);

    expect(h.renderer.stats).toEqual({ created: 2, updated: 0, reused: 0, removed: 0 });
    expect(h.container.querySelector('[data-unknown-type="nope"]')).not.toBeNull();
    expect(elOf(h.container, "child")).not.toBeNull();
  });

  it("stats 是副本：改返回值不影响渲染器内部统计", () => {
    const h = harness();
    h.render(probeNode("root"));

    const snapshot = h.renderer.stats;
    snapshot.created = 99;
    snapshot.removed = 88;

    expect(h.renderer.stats).toEqual({ created: 1, updated: 0, reused: 0, removed: 0 });
  });

  it("dispose 不参与统计：不累加 removed，也不清零 stats", () => {
    const h = harness();
    h.render(probeNode("root", [probeNode("a")]));

    h.renderer.dispose();

    expect(h.renderer.stats).toEqual({ created: 2, updated: 0, reused: 0, removed: 0 });
    expect(h.container.children).toHaveLength(0);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import type { Node } from "../../renderer/types";
import { compose, type Contribution } from "./compose";

function node(type: string, props: Record<string, unknown> = {}, children: Node[] = []): Node {
  return { type, props, children };
}

/** 带键的节点：键写在 props.key 里，是贡献唯一能瞄准的东西。 */
function slot(key: string, children: Node[] = []): Node {
  return node("slot", { key }, children);
}

function row(key: string): Node {
  return node("row", { key });
}

function contribution(
  owner: string,
  target: string,
  op: Contribution["op"],
  tree: Node,
  order?: number,
  seq?: number,
): Contribution {
  return { owner, target, op, tree, order, seq };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("compose：基本形状", () => {
  it("没有贡献时返回传入的同一棵树，索引按节点的 props.key 建立", () => {
    const first = slot("ideas.home.slot");
    const second = node("panel", { key: "ideas.feed" });
    const root = node("column", {}, [first, second]);

    const result = compose(root, []);

    expect(result.tree).toBe(root);
    expect(result.index.get("ideas.home.slot")).toBe(first);
    expect(result.index.get("ideas.feed")).toBe(second);
  });

  it("键只认非空字符串：空串、数字、缺省都不进索引", () => {
    const root = node("column", {}, [
      node("slot", { key: "" }),
      node("slot", { key: 42 }),
      node("slot", { label: "无键" }),
    ]);

    const { index } = compose(root, []);

    expect(index.size).toBe(0);
  });
});

describe("compose：四种挂接动作", () => {
  it("replace：贡献的树顶替目标节点，键打在新树根上（覆盖链靠它接下去）", () => {
    const other = slot("om.window.nav");
    const target = slot("om.window.page");
    const root = node("column", {}, [other, target]);

    const { tree, index } = compose(root, [
      contribution("ideas", "om.window.page", "replace", node("split")),
    ]);

    const composed = tree.children[1];
    expect(composed?.type).toBe("split");
    expect(composed?.props).toEqual({ key: "om.window.page" });
    expect(index.get("om.window.page")).toBe(composed);
    expect(tree.children[0]).toBe(other);
  });

  it("before：插在目标节点前面，目标与其它兄弟保持原引用", () => {
    const other = slot("ideas.home.rail");
    const target = slot("ideas.home.after_capture");
    const root = node("column", {}, [other, target]);
    const inserted = row("projects.block");

    const { tree } = compose(root, [
      contribution("projects", "ideas.home.after_capture", "before", inserted),
    ]);

    expect(tree.children.map((child) => child.props.key)).toEqual([
      "ideas.home.rail",
      "projects.block",
      "ideas.home.after_capture",
    ]);
    expect(tree.children[0]).toBe(other);
    expect(tree.children[1]).toBe(inserted);
    expect(tree.children[2]).toBe(target);
  });

  it("after：插在目标节点后面", () => {
    const target = slot("ideas.home.after_capture");
    const other = slot("ideas.home.rail");
    const root = node("column", {}, [target, other]);
    const inserted = row("projects.block");

    const { tree } = compose(root, [
      contribution("projects", "ideas.home.after_capture", "after", inserted),
    ]);

    expect(tree.children.map((child) => child.props.key)).toEqual([
      "ideas.home.after_capture",
      "projects.block",
      "ideas.home.rail",
    ]);
    expect(tree.children[0]).toBe(target);
    expect(tree.children[1]).toBe(inserted);
    expect(tree.children[2]).toBe(other);
  });

  it("append：放进目标节点的子节点末尾，原有子节点仍是原对象", () => {
    const existing = node("text", { text: "已有" });
    const target = slot("ideas.home.slot", [existing]);
    const root = node("column", {}, [target]);
    const appended = row("ideas.block");

    const { tree, index } = compose(root, [
      contribution("ideas", "ideas.home.slot", "append", appended),
    ]);

    expect(tree.children[0]?.children).toEqual([existing, appended]);
    expect(tree.children[0]?.children[0]).toBe(existing);
    expect(tree.children[0]?.children[1]).toBe(appended);
    expect(index.get("ideas.block")).toBe(tree.children[0]?.children[1]);
  });
});

describe("compose：全序", () => {
  it("order 小的先落，同 order 按 owner 字典序决定文档顺序", () => {
    const target = slot("home.slot");
    const root = node("column", {}, [target]);

    const { tree } = compose(root, [
      contribution("beta", "home.slot", "after", row("beta.block"), 20),
      contribution("omega", "home.slot", "after", row("omega.block"), 10),
      contribution("alpha", "home.slot", "after", row("alpha.block"), 20),
    ]);

    expect(tree.children.map((child) => child.props.key)).toEqual([
      "home.slot",
      "omega.block",
      "alpha.block",
      "beta.block",
    ]);
  });

  it("同 order 同 owner 按 seq 排", () => {
    const target = slot("home.slot");
    const root = node("column", {}, [target]);

    const { tree } = compose(root, [
      contribution("ideas", "home.slot", "after", row("ideas.second"), 10, 2),
      contribution("ideas", "home.slot", "after", row("ideas.first"), 10, 1),
    ]);

    expect(tree.children.map((child) => child.props.key)).toEqual([
      "home.slot",
      "ideas.first",
      "ideas.second",
    ]);
  });
});

describe("compose：落点", () => {
  it("落点不存在的贡献丢弃并警告，树保持原引用", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const root = node("column", {}, [slot("home.slot")]);

    const { tree, index } = compose(root, [
      contribution("ghost", "home.missing", "append", row("ghost.block")),
    ]);

    expect(tree).toBe(root);
    expect(index.has("ghost.block")).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("home.missing");
  });

  it("先落地的贡献带进来的键，下一轮才可用", () => {
    const root = node("column", {}, [slot("home.slot")]);
    const feed = slot("ideas.feed");

    const { tree } = compose(root, [
      contribution("ideas", "home.slot", "append", feed, 10),
      contribution("ideas", "ideas.feed", "after", row("ideas.feed.footer"), 20),
    ]);

    // after 是同级挂在 feed 后面，不是塞进 feed 的子节点。
    expect(tree.children[0]?.children.map((child) => child.props.key)).toEqual([
      "ideas.feed",
      "ideas.feed.footer",
    ]);
    expect(tree.children[0]?.children[0]).toBe(feed);
  });

  it("replace 的目标就是整棵树的根：整棵换掉，目标键打在新根上", () => {
    const root = slot("om.window.page", [node("text", { text: "旧" })]);
    const replacement = node("split");

    const { tree, index } = compose(root, [
      contribution("ideas", "om.window.page", "replace", replacement),
    ]);

    expect(tree).not.toBe(root);
    expect(tree.type).toBe("split");
    expect(tree.props).toEqual({ key: "om.window.page" });
    expect(index.get("om.window.page")).toBe(tree);
  });

  it("根节点没有兄弟：before / after 挂不上，按死键丢弃", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const root = slot("om.window.page");

    const { tree } = compose(root, [
      contribution("ideas", "om.window.page", "before", row("ideas.block")),
      contribution("projects", "om.window.page", "after", row("projects.block")),
    ]);

    expect(tree).toBe(root);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("贡献自己的树里含有目标键：拒绝并警告（成环），树保持原引用", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const root = node("column", {}, [slot("ideas.home.slot")]);
    const cyclic = node("column", {}, [slot("ideas.home.slot")]);

    const { tree } = compose(root, [contribution("ideas", "ideas.home.slot", "append", cyclic)]);

    expect(tree).toBe(root);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("ideas.home.slot");
  });
});

describe("compose：覆盖链（replace 之后键还在）", () => {
  it("连续两次 replace 同一个键：后到的一份是结果，键仍在", () => {
    const root = node("column", {}, [slot("home.slot")]);

    const { tree, index } = compose(root, [
      contribution("alpha", "home.slot", "replace", node("panel", { title: "先" }), 10),
      contribution("beta", "home.slot", "replace", node("panel", { title: "后" }), 20),
    ]);

    expect(tree.children[0]?.props).toEqual({ title: "后", key: "home.slot" });
    expect(index.get("home.slot")).toBe(tree.children[0]);
  });

  it("replace 之后再 after 到同一个键，仍然生效", () => {
    const root = node("column", {}, [slot("home.slot")]);

    const { tree } = compose(root, [
      contribution("alpha", "home.slot", "replace", node("panel", { title: "新" }), 10),
      contribution("beta", "home.slot", "after", row("beta.block"), 20),
    ]);

    expect(tree.children.map((child) => child.props.key)).toEqual(["home.slot", "beta.block"]);
    expect(tree.children[0]?.props.title).toBe("新");
  });

  it("替换树根自带别的键：警告并强制改成目标键", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const root = node("column", {}, [slot("home.slot")]);

    const { tree } = compose(root, [
      contribution("ideas", "home.slot", "replace", node("panel", { key: "ideas.page" })),
    ]);

    expect(tree.children[0]?.props).toEqual({ key: "home.slot" });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("ideas.page");
  });

  it("替换树的子孙里带目标键：仍按成环拒绝", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const root = node("column", {}, [slot("home.slot")]);
    const cyclic = node("panel", {}, [slot("home.slot")]);

    const { tree } = compose(root, [contribution("ideas", "home.slot", "replace", cyclic)]);

    expect(tree).toBe(root);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("home.slot");
  });
});

describe("compose：幂等与顺序无关", () => {
  it("同一 (owner, target, op) 重复到达只落一次，后来的一份顶替前一份", () => {
    const root = node("column", {}, [slot("home.slot")]);
    const first = row("ideas.first");
    const second = row("ideas.second");

    const once = compose(root, [contribution("ideas", "home.slot", "append", first)]);
    const twice = compose(root, [
      contribution("ideas", "home.slot", "append", first),
      contribution("ideas", "home.slot", "append", second),
    ]);

    expect(once.tree.children[0]?.children).toEqual([first]);
    expect(twice.tree.children[0]?.children).toEqual([second]);
  });

  it("同一批贡献跑两次，结果相同", () => {
    const root = node("column", {}, [slot("home.slot")]);
    const batch: Contribution[] = [
      contribution("ideas", "home.slot", "append", row("ideas.block"), 10),
      contribution("projects", "home.slot", "after", row("projects.block"), 20),
    ];

    const first = compose(root, batch);
    const second = compose(root, batch);

    expect(second.tree).toEqual(first.tree);
    expect([...second.index.keys()]).toEqual([...first.index.keys()]);
  });

  it("打乱贡献顺序，结果相同", () => {
    const makeRoot = (): Node => node("column", {}, [slot("home.slot")]);
    const batch: Contribution[] = [
      contribution("zeta", "home.slot", "append", row("p.append"), 30),
      contribution("alpha", "home.slot", "after", row("p.after"), 20),
      contribution("mid", "home.slot", "before", row("p.before"), 25),
      contribution("omega", "home.slot", "append", row("p.append2"), 10),
    ];

    const base = compose(makeRoot(), batch).tree;

    expect(compose(makeRoot(), [...batch].reverse()).tree).toEqual(base);
    expect(
      compose(makeRoot(), [batch[1], batch[3], batch[0], batch[2]] as Contribution[]).tree,
    ).toEqual(base);
  });
});

describe("compose：不可变与失败隔离", () => {
  it("没碰到的子树保持原引用，改过的路径逐层重建", () => {
    const untouchedChild = node("text", { text: "甲" });
    const panelA = node("panel", { key: "a.panel" }, [untouchedChild]);
    const panelB = node("panel", { key: "b.panel" }, [node("text", { text: "乙" })]);
    const root = node("column", {}, [panelA, panelB]);

    const { tree } = compose(root, [
      contribution("a", "a.panel", "append", node("text", { key: "a.extra", text: "丙" })),
    ]);

    expect(tree).not.toBe(root);
    expect(tree.children[0]).not.toBe(panelA);
    expect(tree.children[0]?.children[0]).toBe(untouchedChild);
    expect(tree.children[1]).toBe(panelB);
  });

  it("坏的贡献只丢自己，好的照常落", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const root = node("column", {}, [slot("home.slot")]);

    const { tree } = compose(root, [
      contribution("ghost", "home.missing", "append", row("ghost.block")),
      contribution("ideas", "home.slot", "append", row("ideas.block")),
      contribution("cycle", "home.slot", "append", slot("home.slot")),
    ]);

    expect(tree.children[0]?.children.map((child) => child.props.key)).toEqual(["ideas.block"]);
    expect(warn).toHaveBeenCalledTimes(2);
  });
});

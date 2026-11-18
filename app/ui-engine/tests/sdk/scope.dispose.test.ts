import { describe, expect, it } from "vitest";
import {
  Host,
  HostGone,
  Node,
  ScopeError,
  LIFECYCLE_HOOKS,
  type LifecycleHook,
  type LifecycleHooks,
  type RequestHandler,
} from "../../src/sdk/index";

interface LoggedHook {
  readonly hook: LifecycleHook;
  readonly node: Node;
}

function logHooks(log: LoggedHook[]): LifecycleHooks {
  const hooks: LifecycleHooks = {};
  for (const hook of LIFECYCLE_HOOKS) {
    hooks[hook] = (node) => {
      log.push({ hook, node });
    };
  }
  return hooks;
}

function makeNode(
  kind: string,
  options: { log?: LoggedHook[]; handler?: RequestHandler } = {},
): Node {
  const { log, handler } = options;
  return new Node({
    kind,
    lifecycle: log === undefined ? undefined : logHooks(log),
    host: handler === undefined ? undefined : (owner, child) => new Host({ owner, child, handler }),
  });
}

function unmountOrder(log: LoggedHook[]): string[] {
  return log.filter((entry) => entry.hook === "on_unmount").map((entry) => entry.node.kind);
}

function disposeOrder(log: LoggedHook[]): string[] {
  return log.filter((entry) => entry.hook === "on_dispose").map((entry) => entry.node.kind);
}

function expectScopeError(action: () => unknown, code: string): void {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(ScopeError);
    expect((error as ScopeError).code).toBe(code);
    return;
  }
  throw new Error("expected ScopeError " + code);
}

describe("remove：只摘直接 child，保留 child 自己的子树", () => {
  it("remove 后 child 的子树结构保留，可再次挂载", () => {
    const log: LoggedHook[] = [];
    const parent = makeNode("window");
    const child = makeNode("column", { log });
    const first = makeNode("text", { log });
    const second = makeNode("text", { log });
    parent.add(child);
    child.add(first);
    child.add(second);

    parent.remove(child);

    expect(parent.children).toEqual([]);
    expect(child.parent).toBeNull();
    expect(child.mounted).toBe(false);
    expect(child.host).toBeNull();
    expect(child.children).toEqual([first, second]);
    expect(first.parent?.id).toBe(child.id);
    expect(first.host).toBeNull();
    expect(second.mounted).toBe(false);

    log.length = 0;
    parent.add(child);
    expect(parent.children).toEqual([child]);
    expect(log.map((entry) => entry.hook)).toEqual(["on_mount", "on_mount", "on_mount"]);
    expect(log.map((entry) => entry.node)).toEqual([child, first, second]);
  });

  it("children 只包含直接子节点", () => {
    const root = makeNode("app");
    const page = makeNode("page");
    const panel = makeNode("panel");
    const title = makeNode("title");
    root.add(page);
    page.add(panel);
    panel.add(title);

    expect(root.children).toEqual([page]);
    expect(root.children).not.toContain(panel);
    expect(page.children).toEqual([panel]);
    expect(panel.children).toEqual([title]);
  });
});

describe("root unmount：保留子树", () => {
  it("unmount 只关 host，结构 / children / 节点仍保留", () => {
    const root = makeNode("app");
    const page = makeNode("page");
    const panel = makeNode("panel");
    const title = makeNode("title");
    root.add(page);
    page.add(panel);
    panel.add(title);

    root.unmount();

    expect(root.children).toEqual([page]);
    expect(page.children).toEqual([panel]);
    expect(panel.children).toEqual([title]);
    expect(root.disposed).toBe(false);
    expect(page.disposed).toBe(false);
    expect(page.host).toBeNull();
    expect(title.mounted).toBe(false);
    expect(title.request("focus")).toBeInstanceOf(HostGone);

    // 结构保留到足以再次挂载：page 仍是 root 的 child。
    expect(page.parent?.id).toBe(root.id);
  });
});

describe("dispose：root-only 永久销毁", () => {
  it("子节点 dispose 抛 E-SCOPE-PARENT；root dispose 后不可再挂载", () => {
    const root = makeNode("app");
    const page = makeNode("page");
    root.add(page);

    expectScopeError(() => page.dispose(), "E-SCOPE-PARENT");

    root.dispose();

    expect(root.disposed).toBe(true);
    expect(page.disposed).toBe(true);
    expect(root.children).toEqual([page]);
    expect(page.host).toBeNull();
    expect(page.request("focus")).toBeInstanceOf(HostGone);

    expect(() => root.add(makeNode("late"))).toThrow(/已销毁/);
    expect(() => makeNode("other").add(root)).toThrow(/已销毁/);
  });

  it("dispose 先 unmount 再 dispose，两个阶段都子先父后", () => {
    const log: LoggedHook[] = [];
    const app = makeNode("app", { log });
    const page = makeNode("page", { log });
    const leaf = makeNode("button", { log });
    app.add(page);
    page.add(leaf);
    log.length = 0;

    app.dispose();

    expect(log.map((entry) => entry.hook)).toEqual([
      "on_unmount",
      "on_unmount",
      "on_unmount",
      "on_dispose",
      "on_dispose",
      "on_dispose",
    ]);
    expect(unmountOrder(log)).toEqual(["button", "page", "app"]);
    expect(disposeOrder(log)).toEqual(["button", "page", "app"]);
    expect([app.disposed, page.disposed, leaf.disposed]).toEqual([true, true, true]);
  });

  it("先 unmount 再 dispose 时不再重复 unmount；dispose 幂等", () => {
    const log: LoggedHook[] = [];
    const app = makeNode("app", { log });
    const page = makeNode("page", { log });
    const leaf = makeNode("button", { log });
    app.add(page);
    page.add(leaf);
    app.unmount();
    log.length = 0;

    app.dispose();
    const afterFirst = log.length;
    app.dispose();

    expect(log.length).toBe(afterFirst);
    expect(log.map((entry) => entry.hook)).toEqual(["on_dispose", "on_dispose", "on_dispose"]);
    expect(disposeOrder(log)).toEqual(["button", "page", "app"]);
    expect(unmountOrder(log)).toEqual([]);
  });
});

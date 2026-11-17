import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CAPABILITY_METHODS,
  CAPABILITY_TYPES,
  Denied,
  Handled,
  Host,
  HostGone,
  LIFECYCLE_HOOKS,
  Node,
  Request,
  RESPONSE_KINDS,
  SCOPE_ERROR_CODES,
  SCOPE_SCHEMA,
  SCOPE_VERSION,
  STANDARD_REQUESTS,
  STANDARD_REQUEST_ERROR_CODE,
  ScopeError,
  Unhandled,
  type CapabilityPortMap,
  type CapabilityType,
  type LifecycleHook,
  type LifecycleHooks,
  type RequestHandler,
} from "./index";

interface ScopeContract {
  schema: string;
  version: number;
  errors: Record<string, string>;
  lifecycle: { hooks: string[] };
  request: {
    standard: Array<{ name: string; fields: Record<string, string> }>;
    responses: string[];
    standardDefault: string;
    noHost: string;
    closedHost: string;
    movedHost: string;
  };
  capability: {
    types: Array<{ name: string; methods: string[] }>;
    notGranted: string;
    revoked: string;
    hostGone: string;
    hostMoved: string;
  };
}

const CONTRACT_URL = new URL("../../../../schema/sdk/scope.json", import.meta.url);
const contract = JSON.parse(readFileSync(fileURLToPath(CONTRACT_URL), "utf8")) as ScopeContract;

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
  options: { id?: string; log?: LoggedHook[]; handler?: RequestHandler } = {},
): Node {
  const { id, log, handler } = options;
  return new Node({
    kind,
    id,
    lifecycle: log === undefined ? undefined : logHooks(log),
    host: handler === undefined ? undefined : (owner, child) => new Host({ owner, child, handler }),
  });
}

function hostOf(node: Node): Host {
  const host = node.host;
  if (host === null) {
    throw new Error("节点没有 host: " + node.id);
  }
  return host;
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

function portOf<T extends CapabilityType>(node: Node, type: T): CapabilityPortMap[T] {
  const port = hostOf(node).capability(type);
  if (port === undefined) {
    throw new Error("缺少端口: " + type);
  }
  return port;
}

/** 一个父：收到标准请求时把给定子节点 remove 掉。 */
function parentThatRemoves(child: Node): Node {
  let parent: Node | null = null;
  parent = makeNode("parent", {
    handler: (_request, host) => {
      if (parent === null) {
        throw new Error("parent 未就绪");
      }
      parent.remove(child);
      return host.handle();
    },
  });
  parent.add(child);
  return parent;
}

describe("契约对齐（schema/sdk/scope.json）", () => {
  it("schema / version / 错误码 / lifecycle hooks 与契约一致", () => {
    expect([SCOPE_SCHEMA, SCOPE_VERSION]).toEqual([contract.schema, contract.version]);
    expect([[...SCOPE_ERROR_CODES], [...LIFECYCLE_HOOKS]]).toEqual([
      Object.keys(contract.errors),
      contract.lifecycle.hooks,
    ]);
  });

  it("标准请求 / 响应种类 / 默认错误码与契约一致", () => {
    expect(STANDARD_REQUESTS).toEqual(
      Object.fromEntries(contract.request.standard.map((entry) => [entry.name, entry.fields])),
    );
    expect([...RESPONSE_KINDS]).toEqual(contract.request.responses);
    expect(STANDARD_REQUEST_ERROR_CODE).toBe(contract.request.standardDefault);
  });

  it("能力类型 / 方法 / 实际端口与契约一致", () => {
    expect([...CAPABILITY_TYPES]).toEqual(contract.capability.types.map((entry) => entry.name));
    expect(CAPABILITY_METHODS).toEqual(
      Object.fromEntries(contract.capability.types.map((entry) => [entry.name, entry.methods])),
    );
    const root = makeNode("root");
    const child = makeNode("child");
    root.add(child);
    for (const type of CAPABILITY_TYPES) {
      root.grant(child, type);
    }
    for (const entry of contract.capability.types) {
      const port = portOf(child, entry.name as CapabilityType);
      expect(
        Object.keys(port)
          .filter((key) => key !== "type")
          .sort(),
      ).toEqual([...entry.methods].sort());
    }
  });
});

describe("父权限：子不能改父", () => {
  it("parent 是只读快照；子调用 unmount 抛 E-SCOPE-PARENT", () => {
    const parent = makeNode("window", { id: "1111111111111111" });
    const child = makeNode("button");
    parent.add(child);

    const ref = child.parent;
    if (ref === null) {
      throw new Error("child 应有 parent");
    }
    expect(ref).toEqual({ id: "1111111111111111", kind: "window" });
    expect(Object.isFrozen(ref)).toBe(true);
    expect(Reflect.set(ref, "kind", "hacked")).toBe(false);
    expectScopeError(() => child.unmount(), "E-SCOPE-PARENT");
    expect(child.parent).not.toBeNull();
  });

  it("remove / move / grant 只能由当前父调用", () => {
    const parent = makeNode("window");
    const child = makeNode("button");
    const sibling = makeNode("label");
    parent.add(child);
    parent.add(sibling);

    expectScopeError(() => child.remove(parent), "E-SCOPE-PARENT");
    expectScopeError(() => child.remove(sibling), "E-SCOPE-NOT-CHILD");
    expectScopeError(() => sibling.remove(child), "E-SCOPE-NOT-CHILD");
    expectScopeError(() => sibling.move(child, sibling), "E-SCOPE-NOT-CHILD");
    expectScopeError(() => sibling.grant(child, "focus"), "E-SCOPE-NOT-CHILD");
  });

  it("patch 只改自己并触发 on_update", () => {
    const log: LoggedHook[] = [];
    const parent = makeNode("window");
    const child = makeNode("button", { log });
    const sibling = makeNode("label");
    parent.add(child);
    parent.add(sibling);
    log.length = 0;

    child.patch({ props: { label: "x" }, state: { count: 1 } });

    expect(child.props).toEqual({ label: "x" });
    expect(parent.props).toEqual({});
    expect(sibling.props).toEqual({});
    expect(log.map((entry) => entry.hook)).toEqual(["on_update"]);
    expect(log.map((entry) => entry.node)).toEqual([child]);
  });
});

describe("生命周期：hooks 与顺序", () => {
  it("on_create 在构造期触发，此时还没有 parent / host", () => {
    const log: LoggedHook[] = [];
    const page = makeNode("page", { log });

    expect(log.map((entry) => entry.hook)).toEqual(["on_create"]);
    expect(log[0]?.node).toBe(page);
    expect([page.parent, page.host, page.mounted]).toEqual([null, null, false]);
    expect(page.id).toMatch(/^[0-9a-f]{16}$/);
  });

  it("mount 父先子后，remove 时 unmount 子先父后", () => {
    const log: LoggedHook[] = [];
    const root = makeNode("app");
    const page = makeNode("page", { log });
    const panel = makeNode("panel", { log });
    const title = makeNode("title", { log });
    root.add(page);
    page.add(panel);
    panel.add(title);
    log.length = 0;

    root.remove(page);
    expect(log.map((entry) => entry.hook)).toEqual(["on_unmount", "on_unmount", "on_unmount"]);
    expect(log.map((entry) => entry.node)).toEqual([title, panel, page]);

    log.length = 0;
    root.add(page);
    expect(log.map((entry) => entry.hook)).toEqual(["on_mount", "on_mount", "on_mount"]);
    expect(log.map((entry) => entry.node)).toEqual([page, panel, title]);
  });

  it("root unmount 级联：unmount 子先父后（含 root），子树失去 host", () => {
    const log: LoggedHook[] = [];
    const root = makeNode("app", { log });
    const page = makeNode("page", { log });
    const panel = makeNode("panel", { log });
    const title = makeNode("title", { log });
    root.add(page);
    page.add(panel);
    panel.add(title);
    log.length = 0;

    root.unmount();

    expect(log.map((entry) => entry.hook)).toEqual([
      "on_unmount",
      "on_unmount",
      "on_unmount",
      "on_unmount",
    ]);
    expect(log.map((entry) => entry.node)).toEqual([title, panel, page, root]);
    expect(title.host).toBeNull();
    expect(title.request("focus")).toBeInstanceOf(HostGone);
  });

  it("子节点自移除走 request(remove_self)", () => {
    const child = makeNode("button");
    parentThatRemoves(child);

    // 父处理 remove_self 会把节点移走，应答按 host 已关闭落成 HostGone。
    expect(child.request("remove_self")).toBeInstanceOf(HostGone);
    expect(child.parent).toBeNull();
    expect(child.mounted).toBe(false);
  });
});

describe("成环 / 重复挂载 / 自移", () => {
  it("拒绝成环、重复挂载与移到自身或后代", () => {
    const root = makeNode("root");
    const mid = makeNode("mid");
    const leaf = makeNode("leaf");
    root.add(mid);
    mid.add(leaf);

    expectScopeError(() => leaf.add(root), "E-SCOPE-CYCLE");
    expectScopeError(() => mid.add(mid), "E-SCOPE-CYCLE");

    const other = makeNode("other");
    expectScopeError(() => other.add(leaf), "E-SCOPE-DUP-MOUNT");

    const grandchild = makeNode("grandchild");
    leaf.add(grandchild);
    expectScopeError(() => mid.move(leaf, leaf), "E-SCOPE-MOVE-SELF");
    expectScopeError(() => mid.move(leaf, grandchild), "E-SCOPE-MOVE-SELF");
  });
});

describe("move：保留身份、host moved、capability 失效", () => {
  it("跨父 move 保留 id/state；旧 host 记为 moved 而不是 gone", () => {
    const log: LoggedHook[] = [];
    const root = makeNode("app");
    const left = makeNode("left");
    const right = makeNode("right");
    root.add(left);
    root.add(right);
    const child = makeNode("button", { log });
    left.add(child);
    child.patch({ state: { count: 1 } });
    left.grant(child, "focus");
    const id = child.id;
    const oldHost = hostOf(child);
    const port = portOf(child, "focus");
    log.length = 0;

    left.move(child, right);

    expect({ id: child.id, state: child.state, parent: child.parent }).toEqual({
      id,
      state: { count: 1 },
      parent: { id: right.id, kind: "right" },
    });
    expect(child.mounted).toBe(true);
    expect([oldHost.moved, oldHost.closed, child.host === oldHost]).toEqual([true, false, false]);
    expect(oldHost.request(new Request("focus")).kind).toBe(contract.request.movedHost);
    expect(log.map((entry) => entry.hook)).toEqual(["on_reparent"]);

    // 能力随 rebind 失效：旧端口抛 HOST-MOVED，新父重新 grant 才可用。
    expectScopeError(() => port.focus(), contract.capability.hostMoved);
    expect(hostOf(child).capability("focus")).toBeUndefined();
    right.grant(child, "focus");
    expect(portOf(child, "focus")).toBeDefined();

    // remount 走“卸载再挂载”：on_unmount -> on_reparent -> on_mount。
    log.length = 0;
    right.move(child, left, { remount: true });
    expect(log.map((entry) => entry.hook)).toEqual(["on_unmount", "on_reparent", "on_mount"]);
    expect(child.mounted).toBe(true);
  });
});

describe("clone：新身份、detached、复制 state", () => {
  it("clone 出新 id 的 detached 子树，不共享 state 且可再挂载", () => {
    const parent = makeNode("parent");
    const original = makeNode("button");
    parent.add(original);
    original.patch({ props: { label: "a" }, state: { count: 1 } });
    const icon = makeNode("icon");
    original.add(icon);

    const copy = original.clone();

    expect(copy.id).not.toBe(original.id);
    expect(copy.id).toMatch(/^[0-9a-f]{16}$/);
    expect(copy.parent).toBeNull();
    expect(copy.mounted).toBe(false);
    expect(copy.host).toBeNull();
    expect(copy.props).toEqual({ label: "a" });
    expect(copy.state).toEqual({ count: 1 });
    copy.patch({ state: { count: 2 } });
    expect(original.state).toEqual({ count: 1 });

    const copyChild = copy.children[0];
    if (copyChild === undefined) {
      throw new Error("clone 应复制子树");
    }
    expect(copyChild.id).not.toBe(icon.id);
    expect(copyChild.parent?.id).toBe(copy.id);
    expect(copyChild.mounted).toBe(false);

    parent.add(copy);
    expect(copy.mounted).toBe(true);
    expect(copyChild.mounted).toBe(true);
  });
});

describe("host / request：immediate host、handle / deny / forward", () => {
  it("标准请求无 handler 抛契约默认错；未知请求回 unhandled；无 host 回 HostGone", () => {
    const root = makeNode("root");
    const child = makeNode("child");
    root.add(child);

    expectScopeError(() => child.request("focus"), contract.request.standardDefault);
    expect(child.request("bogus")).toBeInstanceOf(Unhandled);
    expect(makeNode("detached").request("focus").kind).toBe(contract.request.noHost);
  });

  it("父 handle / deny 标准请求", () => {
    const parent = makeNode("window", {
      handler: (request, host) =>
        request.name === "focus" ? host.handle("ok") : host.deny("不许导航"),
    });
    const child = makeNode("button");
    parent.add(child);

    const handled = child.request("focus");
    expect(handled).toBeInstanceOf(Handled);
    expect((handled as Handled).value).toBe("ok");

    const denied = child.request("navigate", { route: "/x" });
    expect(denied).toBeInstanceOf(Denied);
    expect((denied as Denied).code).toBe("E-SCOPE-PARENT");
  });

  it("请求不自动冒泡；显式 forward 才上一层", () => {
    const received: string[] = [];
    const root = makeNode("root", {
      handler: (request, host) => {
        received.push(request.name);
        return host.handle();
      },
    });
    const section = makeNode("section");
    root.add(section);
    const leaf = makeNode("button");
    section.add(leaf);
    expectScopeError(() => leaf.request("focus"), "E-SCOPE-REQUEST-UNHANDLED");

    const forwarding = makeNode("section", { handler: (request, host) => host.forward(request) });
    root.add(forwarding);
    const forwarded = makeNode("button");
    forwarding.add(forwarded);

    expect(forwarded.request("focus")).toBeInstanceOf(Handled);
    expect(received).toEqual(["focus"]);
  });

  it("closed host 回 HostGone；in-flight move 回 HostMoved；in-flight remove 回 HostGone", () => {
    const right = makeNode("right");
    const root = makeNode("root");
    root.add(right);
    const moved = makeNode("button");
    let movingParent: Node | null = null;
    movingParent = makeNode("left", {
      handler: (_request, host) => {
        if (movingParent === null) {
          throw new Error("parent 未就绪");
        }
        movingParent.move(moved, right);
        return host.handle();
      },
    });
    root.add(movingParent);
    movingParent.add(moved);
    expect(moved.request("focus").kind).toBe(contract.request.movedHost);

    const removed = makeNode("button");
    parentThatRemoves(removed);
    expect(removed.request("focus")).toBeInstanceOf(HostGone);

    const plain = makeNode("plain");
    const leaf = makeNode("leaf");
    plain.add(leaf);
    plain.grant(leaf, "scroll");
    const scroll = portOf(leaf, "scroll");
    hostOf(leaf).close();
    expect(leaf.request("focus").kind).toBe(contract.request.closedHost);
    expectScopeError(() => scroll.into_view(), contract.capability.hostGone);
  });
});

describe("capability：父 grant / revoke 窄端口", () => {
  it("未授予返回 undefined；grant 后端口把调用翻译成标准请求", () => {
    const seen: string[] = [];
    const root = makeNode("root", {
      handler: (request, host) => {
        seen.push(request.name);
        return host.handle(request.fields);
      },
    });
    const child = makeNode("child");
    root.add(child);

    expect(hostOf(child).capability("navigation")).toBeUndefined();
    root.grant(child, "navigation");
    const response = portOf(child, "navigation").navigate("/ideas");
    expect(response).toBeInstanceOf(Handled);
    expect((response as Handled).value).toEqual({ route: "/ideas" });
    expect(seen).toEqual(["navigate"]);
  });

  it("revoke 后取端口或用端口都抛契约撤销码", () => {
    const root = makeNode("root", { handler: (_request, host) => host.handle() });
    const child = makeNode("child");
    root.add(child);
    root.grant(child, "overlay");
    const port = portOf(child, "overlay");
    expect(port.open("menu", {})).toBeInstanceOf(Handled);

    root.revoke(child, "overlay");

    expectScopeError(() => port.open("menu", {}), contract.capability.revoked);
    expectScopeError(() => hostOf(child).capability("overlay"), contract.capability.revoked);
  });
});

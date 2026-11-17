import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Node, Page, type PageHost } from "../../src/sdk/index";

interface PageContract {
  page: {
    fields: string[];
    noRenderFunction: boolean;
    mount: string;
    unmount: string;
    invalidate: string;
  };
  state: { change: string; scope: string };
  when: {
    attachedTo: string;
    fields: Record<string, string>;
    evaluation: string[];
    identity: string;
    serialization: string;
  };
  bind: {
    attachedTo: string;
    fields: Record<string, string>;
    direction: string;
    evaluation: string[];
    twoWay: boolean;
    serialization: string;
  };
  action: { attachedTo: string; fields: Record<string, string>; effect: string };
  rules: string[];
}

const CONTRACT_URL = new URL("../../../../schema/sdk/page.json", import.meta.url);
const contract = JSON.parse(readFileSync(fileURLToPath(CONTRACT_URL), "utf8")) as PageContract;

/** 假的挂载点：只记录 mount / update / unmount 与 data 来源。 */
class FakeHost implements PageHost {
  readonly data: Record<string, unknown>;
  readonly mounts: Page[] = [];
  readonly updates: Page[] = [];
  readonly unmounts: Page[] = [];

  constructor(data: Record<string, unknown> = {}) {
    this.data = data;
  }

  mount(page: Page): void {
    this.mounts.push(page);
  }

  update(page: Page): void {
    this.updates.push(page);
  }

  unmount(page: Page): void {
    this.unmounts.push(page);
  }
}

interface Fixture {
  page: Page;
  host: FakeHost;
  root: Node;
  header: Node;
  container: Node;
  details: Node;
  summary: Node;
}

function makeNode(kind: string): Node {
  return new Node({ kind });
}

function makeFixture(): Fixture {
  const root = makeNode("app");
  const header = makeNode("header");
  const container = makeNode("container");
  root.add(header);
  root.add(container);
  const details = makeNode("details");
  const summary = makeNode("summary");
  const page = new Page({
    name: "home",
    label: "Home",
    icon: "home",
    root,
    state: { expanded: false, title: "Ideas", settings: { title: "Settings" } },
    actions: {
      expand: (target) => {
        target.state.expanded = true;
      },
      collapse: (target) => {
        target.state.expanded = false;
      },
    },
  });
  page.when(container, {
    condition: (target) => target.state.expanded === true,
    then: [details],
    otherwise: [summary],
  });
  page.bind(header, { prop: "text", source: "state.title" });
  page.bind(details, { prop: "label", source: "state.settings.title" });
  return { page, host: new FakeHost(), root, header, container, details, summary };
}

describe("Page：mount / invalidate", () => {
  it("mount 解析 When / Bind 后交给 host；Page 的 root 是 root Node scope", () => {
    const { page, host, root, header, container, summary } = makeFixture();

    page.mount(host);

    expect(page.mounted).toBe(true);
    expect(host.mounts).toEqual([page]);
    expect(root.parent).toBeNull();
    expect(container.children).toEqual([summary]);
    expect(header.props.text).toBe("Ideas");
    expect(host.updates).toEqual([]);
  });

  it("invalidate 按 state 切换 When 分支，容器与分支 node 身份稳定、兄弟不动", () => {
    const { page, host, root, header, container, details, summary } = makeFixture();
    page.mount(host);
    const detailsId = details.id;

    page.invoke("expand");

    expect(page.state.expanded).toBe(true);
    expect(container.children).toEqual([details]);
    expect(details.id).toBe(detailsId);
    expect(summary.parent).toBeNull();
    expect(root.children).toEqual([header, container]);
    expect(host.updates).toEqual([page]);

    page.state.expanded = false;
    page.invalidate();
    expect(container.children[0]).toBe(summary);
    expect(root.children).toEqual([header, container]);
  });

  it("没有任何状态变化时 invalidate 仍然只重算 When / Bind，不重建容器", () => {
    const { page, host, container, summary } = makeFixture();
    page.mount(host);
    const containerBefore = container;
    const summaryBefore = container.children[0];

    page.invalidate();

    expect(container).toBe(containerBefore);
    expect(container.children[0]).toBe(summaryBefore);
    expect(container.children[0]).toBe(summary);
  });
});

describe("Page：Bind 单向更新", () => {
  it("mount / invalidate 从 state 与 data 路径写 props；节点改不回来源", () => {
    const { page, host, header } = makeFixture();
    page.bind(header, { prop: "owner", source: "data.user.name" });
    host.data.user = { name: "Ada" };

    page.mount(host);
    expect(header.props).toMatchObject({ text: "Ideas", owner: "Ada" });

    header.patch({ props: { text: "local", owner: "local" } });
    page.invalidate();
    expect(header.props).toMatchObject({ text: "Ideas", owner: "Ada" });
    expect(page.state.title).toBe("Ideas");

    (host.data.user as { name: string }).name = "Grace";
    page.invalidate();
    expect(header.props.owner).toBe("Grace");
  });

  it("When 分支下的节点在挂载后继续收到 Bind 更新", () => {
    const { page, host, details } = makeFixture();
    page.mount(host);
    page.invoke("expand");
    expect(details.props.label).toBe("Settings");

    page.state.settings = { title: "Renamed" };
    page.invalidate();
    expect(details.props.label).toBe("Renamed");
  });

  it("非法 source 在注册时就被拒绝", () => {
    const { page, header } = makeFixture();
    expect(() => page.bind(header, { prop: "x", source: "globals.x" })).toThrow(
      /state.* 或 data.*/,
    );
  });
});

describe("Page：Action", () => {
  it("节点事件绑定 action；action 改 page.state 后自动 invalidate", () => {
    const { page, host, header, container, details, summary } = makeFixture();
    page.on(header, "click", "expand");
    page.mount(host);
    const updatesBefore = host.updates.length;

    page.event(header, "click");

    expect(page.state.expanded).toBe(true);
    expect(container.children).toEqual([details]);
    expect(host.updates.length).toBe(updatesBefore + 1);
    expect(summary.parent).toBeNull();
  });

  it("子节点不能直接改 page state；未知 action / 事件抛错", () => {
    const { page, host, header, container, summary } = makeFixture();
    page.mount(host);

    container.patch({ state: { expanded: true } });
    expect(page.state.expanded).toBe(false);
    expect(container.children).toEqual([summary]);

    expect(() => page.invoke("missing")).toThrow(/未知 action/);
    expect(() => page.event(header, "hover")).toThrow(/没有事件绑定/);
  });

  it("未挂载时不能执行 action", () => {
    const { page } = makeFixture();
    page.on(makeNode("button"), "click", "expand");
    expect(() => page.invoke("expand")).toThrow(/未挂载/);
  });
});

describe("Page：unmount", () => {
  it("unmount 走 root-only 的 Node.unmount：host 收到通知，子树 retained", () => {
    const { page, host, root, header, container, summary } = makeFixture();
    page.mount(host);

    page.unmount();

    expect(page.mounted).toBe(false);
    expect(host.unmounts).toEqual([page]);
    expect(root.children).toEqual([header, container]);
    expect(container.children).toEqual([summary]);
    expect(header.host).toBeNull();
    expect(() => page.invalidate()).toThrow(/未挂载/);
    expect(() => page.unmount()).toThrow(/未挂载/);
  });
});

describe("Page：契约对齐（schema/sdk/page.json）", () => {
  it("Page 暴露契约 fields，且没有 render 函数", () => {
    const { page } = makeFixture();
    for (const field of contract.page.fields) {
      expect(field in page).toBe(true);
    }
    expect(page.name).toBe("home");
    expect(page.label).toBe("Home");
    expect(page.icon).toBe("home");
    expect(page.root).toBeInstanceOf(Node);
    expect(page.state).toEqual({
      expanded: false,
      title: "Ideas",
      settings: { title: "Settings" },
    });
    expect(page.actions.has("expand")).toBe(true);
    expect(contract.page.noRenderFunction).toBe(true);
    expect("render" in page).toBe(false);
  });

  it("mount / invalidate / state 的契约口径与实现一致", () => {
    expect(contract.page.mount).toBe("host");
    expect(contract.page.unmount).toBe("root-only");
    expect(contract.state.change).toBe("page.invalidate()");
    expect(contract.state.scope).toBe("page");
    expect(contract.when.attachedTo).toBe("node");
    expect(Object.keys(contract.when.fields).sort()).toEqual(["condition", "otherwise", "then"]);
    expect(contract.when.evaluation).toEqual(["mount", "invalidate"]);
    expect(contract.bind.direction).toBe("down");
    expect(contract.bind.twoWay).toBe(false);
    expect(Object.keys(contract.bind.fields).sort()).toEqual(["prop", "source"]);
    expect(contract.action.attachedTo).toBe("node event");
    expect(Object.keys(contract.action.fields).sort()).toEqual(["handler", "name"]);
    expect(contract.rules).toContain("no React/JSX/hooks");
  });
});

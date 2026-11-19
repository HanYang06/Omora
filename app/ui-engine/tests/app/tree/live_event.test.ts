// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { ConnectionStatus, JsonObject } from "../../../src/contract/protocol";
import type { Node as TreeNode } from "../../../src/contract/tree_generated";
import { createLogger } from "../../../src/app/log";
import {
  TreeLiveApp,
  type TreeBuildPayload,
  type TreeConnection,
} from "../../../src/app/tree/live";

const ROOT = "aaaaaaaaaaaaaaaa";
const BUTTON = "bbbbbbbbbbbbbbbb";
const BUTTON_B = "cccccccccccccccc";

function node(
  id: string,
  chain: string,
  kind: string,
  order: number,
  over: Partial<TreeNode> = {},
): TreeNode {
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

function payload(text: string, handler = "h1"): TreeBuildPayload {
  const button = node(BUTTON, ROOT + "." + BUTTON, "button", 10, {
    settings: { text },
    on: { click: handler },
  });
  const root = node(ROOT, ROOT, "app", 0, { layout: [button] });
  return {
    kind: "tree",
    base: { schema: "dendro.tree/1", version: 1, root, pages: [], active: "", data: {} },
    partials: [],
  };
}

function twoPayload(archived: string, pinned: string): TreeBuildPayload {
  const archive = node(BUTTON, ROOT + "." + BUTTON, "button", 10, {
    settings: { text: archived },
    on: { click: "ha" },
  });
  const pin = node(BUTTON_B, ROOT + "." + BUTTON_B, "button", 20, {
    settings: { text: pinned },
    on: { click: "hb" },
  });
  const root = node(ROOT, ROOT, "app", 0, { layout: [archive, pin] });
  return {
    kind: "tree",
    base: { schema: "dendro.tree/1", version: 1, root, pages: [], active: "", data: {} },
    partials: [],
  };
}

class FakeConnection implements TreeConnection {
  readonly calls: Array<{ target: string; method: string; args: JsonObject }> = [];
  private listener: ((status: ConnectionStatus) => void) | undefined;
  private readonly trees: TreeBuildPayload[];

  constructor(trees: TreeBuildPayload[]) {
    this.trees = trees;
  }

  call(target: string, method: string, args: JsonObject): Promise<unknown> {
    this.calls.push({ target, method, args });
    if (target === "ui" && method === "tree") {
      return Promise.resolve(this.trees[0]);
    }
    if (target === "ui" && method === "tree_event") {
      return Promise.resolve(this.trees[1]);
    }
    return Promise.reject(new Error("unexpected call: " + target + "." + method));
  }

  subscribeStatus(listener: (status: ConnectionStatus) => void): void {
    this.listener = listener;
  }

  connect(): void {
    this.listener?.("open");
  }
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("TreeLiveApp 事件回源", () => {
  it("点击 → ui.tree_event → 新树 replace", async () => {
    const connection = new FakeConnection([payload("归档"), payload("已归档", "h2")]);
    const app = new TreeLiveApp(connection, createLogger({ enabled: false }));
    const container = document.createElement("div");
    document.body.append(container);

    app.mount(container);
    await tick();
    const button = container.querySelector<HTMLElement>('[data-type="button"]');
    expect(button?.textContent).toBe("归档");

    button?.click();
    await tick();

    const call = connection.calls.find((item) => item.method === "tree_event");
    expect(call?.args).toEqual({ handler: "h1", payload: {} });
    expect(container.querySelector<HTMLElement>('[data-type="button"]')?.textContent).toBe("已归档");

    app.dispose();
    container.remove();
  });

  it("replace 后焦点回到同一个节点", async () => {
    const connection = new FakeConnection([
      twoPayload("归档", "置顶"),
      twoPayload("已归档", "已置顶"),
    ]);
    const app = new TreeLiveApp(connection, createLogger({ enabled: false }));
    const container = document.createElement("div");
    document.body.append(container);

    app.mount(container);
    await tick();
    const pin = container.querySelector<HTMLElement>('[data-node-id="' + BUTTON_B + '"]');
    pin?.focus();
    expect(document.activeElement).toBe(pin);

    container.querySelector<HTMLElement>('[data-node-id="' + BUTTON + '"]')?.click();
    await tick();

    const nextPin = container.querySelector<HTMLElement>('[data-node-id="' + BUTTON_B + '"]');
    expect(nextPin).not.toBe(pin);
    expect(document.activeElement).toBe(nextPin);

    app.dispose();
    container.remove();
  });
});

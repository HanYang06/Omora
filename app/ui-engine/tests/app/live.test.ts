// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Connection } from "../../src/app/connection";
import type { JsonObject } from "../../src/contract/protocol";
import { createLogger } from "../../src/app/log";
import { LiveSlotApp } from "../../src/app/live";
import { engineMode, wantsLive } from "../../src/app/main";

/** jsdom 下不要用 new URL(..., import.meta.url)：Vite 会改写成 dev server 地址。 */
const HERE = dirname(fileURLToPath(import.meta.url));
const VIEW_FIXTURE_PATH = resolve(HERE, "../../../sdk/tests/fixtures/view.json");

function fixture(): Record<string, unknown> {
  const value: unknown = JSON.parse(readFileSync(VIEW_FIXTURE_PATH, "utf8"));
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("fixture 必须是对象");
  }
  return value as Record<string, unknown>;
}

/** 在 fixture 上改版本 / active / 页面标题，模拟 Python 交来的下一份视图。 */
function viewOf(version: number, active: string, title: string): Record<string, unknown> {
  const value = structuredClone(fixture());
  value.version = version;
  value.active = active;
  const trees = (value.localTrees as Record<string, unknown>).trees as Record<string, unknown>[];
  const root = trees[1]?.root as Record<string, unknown>;
  const children = root.children as Record<string, unknown>[];
  const first = children[0] as Record<string, unknown>;
  first.props = { ...(first.props as Record<string, unknown>), text: title };
  return value;
}

interface FakeConnection {
  connection: {
    call: ReturnType<typeof vi.fn>;
    subscribe: ReturnType<typeof vi.fn>;
    subscribeStatus: (listener: (status: string) => void) => () => void;
    onEvent: (topic: string, listener: (payload: JsonObject) => void) => () => void;
    connect: ReturnType<typeof vi.fn>;
    endpoint: string;
  };
  calls: Array<{ target: string; method: string; args: Record<string, unknown> }>;
  snapshots: Array<(payload: JsonObject) => void>;
}

function fakeConnection(options: { render: unknown; event?: unknown }): FakeConnection {
  const calls: FakeConnection["calls"] = [];
  const snapshots: Array<(payload: JsonObject) => void> = [];
  const connection = {
    call: vi.fn((target: string, method: string, args: Record<string, unknown> = {}) => {
      calls.push({ target, method, args });
      if (target === "ui" && method === "render") {
        return Promise.resolve(options.render);
      }
      if (target === "ui" && method === "event") {
        return Promise.resolve(options.event ?? options.render);
      }
      return Promise.resolve({});
    }),
    subscribe: vi.fn(() => Promise.resolve({ topics: ["ui.snapshot"] })),
    subscribeStatus: (listener: (status: string) => void) => {
      listener("open");
      return () => undefined;
    },
    onEvent: (_topic: string, listener: (payload: JsonObject) => void) => {
      snapshots.push(listener);
      return () => undefined;
    },
    connect: vi.fn(),
    endpoint: "ws://test",
  };
  return { connection, calls, snapshots };
}

function appOf(fake: FakeConnection): LiveSlotApp {
  return new LiveSlotApp(
    fake.connection as unknown as Connection,
    createLogger({ call: () => Promise.resolve({}) }),
    // 关掉自动发现（clock 会起定时器），测试需要的来源用 source 帧推。
    { sources: [] },
  );
}

function runtimeSourcePayload(text: string, owner = "runtime.test"): JsonObject {
  return {
    kind: "source",
    trees: [
      {
        owner,
        mountAt: "dendro.window.nav",
        order: 99,
        seq: 0,
        root: { id: owner, kind: "dendro:text", owner, props: { text }, children: [] },
      },
    ],
  };
}

function mountInto(): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  return container;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("入口模式", () => {
  it("默认走主会话 Slot；只有 engine=slot 走内置预览", () => {
    expect(engineMode("")).toBe("live");
    expect(engineMode("?engine=live")).toBe("live");
    expect(engineMode("?engine=live&debug=1")).toBe("live");
    expect(engineMode("?engine=slot")).toBe("preview");
    expect(engineMode("?engine=tree")).toBe("tree");
    expect(engineMode("?engine=tree&page=ideas")).toBe("tree");
    expect(engineMode("?engine=something")).toBe("live");
    expect(wantsLive("")).toBe(true);
    expect(wantsLive("?engine=slot")).toBe(false);
  });
});

describe("LiveSlotApp：主会话 Slot 运行时", () => {
  it("连上后请求 ui.render(engine=slot)，用视图建引擎并渲染", async () => {
    const fake = fakeConnection({ render: fixture() });
    const container = mountInto();

    appOf(fake).mount(container);

    await vi.waitFor(() => {
      expect(fake.calls).toContainEqual({
        target: "ui",
        method: "render",
        args: {},
      });
      expect(container.textContent).toContain("灵感");
      expect(container.querySelectorAll(".omora-page-link")).toHaveLength(2);
    });
    expect(fake.connection.subscribe).toHaveBeenCalledWith(["ui.snapshot"]);
    const status = container.querySelector<HTMLElement>(".dendro-live-status");
    expect(status?.dataset.status).toBe("open");
    expect(status?.getAttribute("aria-label")).toBe("已连接");
  });

  it("点导航：事件带 engine=slot 回传，返回的新视图换 active 与页面内容", async () => {
    const next = viewOf(2, "page.projects", "项目页");
    const fake = fakeConnection({ render: fixture(), event: next });
    const container = mountInto();
    appOf(fake).mount(container);
    await vi.waitFor(() => {
      expect(container.querySelectorAll(".omora-page-link")).toHaveLength(2);
    });

    container.querySelectorAll<HTMLButtonElement>(".omora-page-link")[1]?.click();

    await vi.waitFor(() => {
      expect(fake.calls).toContainEqual({
        target: "ui",
        method: "event",
        args: { handler: "h1", payload: {} },
      });
      expect(container.textContent).toContain("项目页");
      expect(container.textContent).not.toContain("灵感");
    });
  });

  it("ui.snapshot 推送 view 时同样更新；推送 legacy 快照则忽略", async () => {
    const fake = fakeConnection({ render: fixture() });
    const container = mountInto();
    appOf(fake).mount(container);
    await vi.waitFor(() => {
      expect(container.textContent).toContain("灵感");
    });
    const listener = fake.snapshots[0];
    expect(listener).toBeDefined();

    listener?.({ kind: "snapshot", pages: [] });
    expect(container.textContent).toContain("灵感");

    listener?.(viewOf(2, "page.ideas", "推送的标题"));
    await vi.waitFor(() => {
      expect(container.textContent).toContain("推送的标题");
    });
  });

  it("ui.snapshot 推来的运行后来源会挂上，主视图替换后仍保留", async () => {
    const fake = fakeConnection({ render: fixture(), event: viewOf(2, "page.projects", "项目页") });
    const container = mountInto();
    appOf(fake).mount(container);
    await vi.waitFor(() => {
      expect(container.textContent).toContain("灵感");
    });
    const listener = fake.snapshots[0];
    expect(listener).toBeDefined();

    listener?.(runtimeSourcePayload("RUNTIME"));
    await vi.waitFor(() => {
      expect(container.textContent).toContain("RUNTIME");
    });

    // 主视图全量替换（事件 result v2）：来源靠 keepOwners 留下来。
    container.querySelectorAll<HTMLButtonElement>(".omora-page-link")[1]?.click();
    await vi.waitFor(() => {
      expect(container.textContent).toContain("项目页");
      expect(container.textContent).toContain("RUNTIME");
    });

    listener?.({ kind: "source", trees: [], removed: ["runtime.test"] });
    await vi.waitFor(() => {
      expect(container.textContent).not.toContain("RUNTIME");
    });
  });

  it("第一份 payload 不是 view：不建视图、不抛", async () => {
    const fake = fakeConnection({ render: { kind: "snapshot", pages: [] } });
    const container = mountInto();

    expect(() => appOf(fake).mount(container)).not.toThrow();

    await vi.waitFor(() => {
      expect(fake.calls.some((call) => call.method === "render")).toBe(true);
    });
    // 状态层还在（"已连接"），但视图宿主里没有渲染任何 Slot 树。
    expect(container.querySelector("[data-dendro-layout]")).toBeNull();
    expect(container.querySelector(".dendro-live-host")?.childElementCount).toBe(0);
  });
});

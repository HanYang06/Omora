// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { Connection } from "../core/connection";
import { createLogger } from "../core/log";
import type { JsonObject } from "../core/protocol";
import type { Snapshot } from "../core/types";
import { DomApp } from "./app";

function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    pages: [{ name: "ideas", label: "灵感", icon: "ideas" }],
    page: "ideas",
    meta: "",
    version: 1,
    content: {
      type: "column",
      props: {},
      children: [
        { type: "text", props: { text: "灵感列表" }, children: [] },
        {
          type: "button",
          props: { text: "新建" },
          children: [],
          events: { click: "ideas:1:0" },
        },
      ],
    },
    ...overrides,
  };
}

interface FakeConnection {
  call: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
  unsubscribe: ReturnType<typeof vi.fn>;
  subscribeStatus: (listener: (status: "open") => void) => void;
  onEvent: (topic: string, listener: (payload: JsonObject) => void) => () => void;
  connect: () => void;
  endpoint: string;
}

function fakeConnection(current: Snapshot): {
  connection: FakeConnection;
  events: Array<{ topic: string; listener: (payload: JsonObject) => void }>;
} {
  const events: Array<{ topic: string; listener: (payload: JsonObject) => void }> = [];
  const connection: FakeConnection = {
    call: vi.fn((target: string, method: string) => {
      if (target === "ui" && method === "render") {
        return Promise.resolve(current);
      }
      return Promise.resolve({});
    }),
    subscribe: vi.fn(() => Promise.resolve({ topics: ["ui.snapshot"] })),
    unsubscribe: vi.fn(() => Promise.resolve({ topics: [] })),
    subscribeStatus: (listener) => listener("open"),
    onEvent: (topic, listener) => {
      events.push({ topic, listener });
      return () => undefined;
    },
    connect: () => undefined,
    endpoint: "ws://test",
  };
  return { connection, events };
}

describe("DomApp", () => {
  it("连上后请求 render 并画出来", async () => {
    const { connection } = fakeConnection(snapshot());
    const container = document.createElement("div");
    document.body.append(container);
    const app = new DomApp(
      connection as unknown as Connection,
      createLogger({ call: () => Promise.resolve({}) }),
    );

    app.mount(container);

    await vi.waitFor(() => {
      expect(connection.call).toHaveBeenCalledWith("ui", "render", {});
      expect(container.querySelector(".omora-page-inner")?.textContent).toContain("灵感列表");
    });
    expect(container.querySelector(".omora-conn-label")?.textContent).toBe("已连接");
  });

  it("导航发 render(page)，事件带 handler 回传", async () => {
    const { connection } = fakeConnection(snapshot());
    const container = document.createElement("div");
    document.body.append(container);
    const app = new DomApp(
      connection as unknown as Connection,
      createLogger({ call: () => Promise.resolve({}) }),
    );
    app.mount(container);
    await vi.waitFor(() => {
      expect(container.querySelector(".omora-page-inner")?.textContent).toContain("灵感列表");
    });

    container.querySelector<HTMLButtonElement>(".omora-shell-nav button")?.click();
    await vi.waitFor(() => {
      expect(connection.call).toHaveBeenCalledWith("ui", "render", { page: "ideas" });
    });

    container.querySelector<HTMLButtonElement>(".omora-page-inner button")?.click();
    await vi.waitFor(() => {
      expect(connection.call).toHaveBeenCalledWith("ui", "event", {
        handler: "ideas:1:0",
        payload: {},
      });
    });
  });
});

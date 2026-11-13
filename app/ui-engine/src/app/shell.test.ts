// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { Snapshot } from "../core/types";
import { DomShell } from "./shell";

function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    pages: [{ name: "ideas", label: "灵感", icon: "ideas" }],
    page: "ideas",
    meta: "",
    version: 1,
    content: {
      type: "column",
      props: {},
      children: [{ type: "text", props: { text: "灵感列表" }, children: [] }],
    },
    ...overrides,
  };
}

function shellOf(container: HTMLElement): DomShell {
  return new DomShell(container, {
    onNavigate: vi.fn(),
    onEvent: vi.fn(),
    loadMedia: () => Promise.resolve({ mime: "", data: "" }),
  });
}

describe("DomShell", () => {
  it("画导航、页面内容与连接状态", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const shell = shellOf(container);

    shell.render(snapshot(), "open", "ws://127.0.0.1:8765");

    expect(container.querySelector(".omora-shell-nav button")?.getAttribute("aria-label")).toBe(
      "灵感",
    );
    expect(container.querySelector('[aria-current="page"]')?.getAttribute("data-page")).toBe(
      "ideas",
    );
    expect(container.querySelector(".omora-page-inner")?.textContent).toBe("灵感列表");
    expect(container.querySelector(".omora-conn-label")?.textContent).toBe("已连接");

    shell.dispose();
    container.remove();
  });

  it("导航点击回传 page，换快照原地更新内容", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const onNavigate = vi.fn();
    const shell = new DomShell(container, {
      onNavigate,
      onEvent: vi.fn(),
      loadMedia: () => Promise.resolve({ mime: "", data: "" }),
    });
    shell.render(snapshot(), "open", "ws://x");

    const button = container.querySelector<HTMLButtonElement>(".omora-shell-nav button");
    button?.click();
    expect(onNavigate).toHaveBeenCalledWith("ideas");

    shell.render(
      snapshot({
        page: "ideas",
        content: { type: "text", props: { text: "详情" }, children: [] },
      }),
      "closed",
      "ws://x",
    );

    expect(container.querySelector(".omora-page-inner")?.textContent).toBe("详情");
    expect(container.querySelector(".omora-conn-label")?.textContent).toBe("连接已断开");

    shell.render(null, "closed", "ws://x");
    expect(container.querySelector(".omora-page-inner")?.textContent).toBe("");

    shell.dispose();
    container.remove();
  });
});

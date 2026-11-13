// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { Snapshot } from "../core/types";
import { DomShell } from "../app/shell";
import { initialSnapshot } from "../render/boot";
import { withContributions } from "../render/view";
import { compileSkeleton } from "./skeleton";

function bootView(): Snapshot {
  const view = withContributions(initialSnapshot());
  if (view === null) {
    throw new Error("生成的启动骨架是空的");
  }
  return view;
}

/** 运行时画一遍，作为"编译产物 == 运行时结构"的对照。 */
function runtimeHtml(view: Snapshot | null): string {
  const container = document.createElement("div");
  const shell = new DomShell(container, {
    onNavigate: () => undefined,
    onEvent: () => undefined,
    loadMedia: () => Promise.reject(new Error("no media")),
  });
  shell.render(view, "idle", "");
  const html = container.innerHTML;
  shell.dispose();
  return html;
}

function parse(html: string): HTMLElement {
  const container = document.createElement("div");
  container.innerHTML = html;
  return container;
}

describe("compileSkeleton", () => {
  it("编译出母页面壳：导航、当前页、状态", () => {
    const view = bootView();
    const root = parse(compileSkeleton(view));

    const app = root.querySelector<HTMLElement>(".omora-app");
    expect(app?.dataset.connection).toBe("idle");
    expect(root.querySelector(".omora-conn-label")?.textContent).toBe("未连接");

    const buttons = root.querySelectorAll<HTMLButtonElement>(".omora-shell-nav button");
    expect(buttons).toHaveLength(view.pages.length);
    const current = root.querySelector('.omora-shell-nav [aria-current="page"]');
    expect(current?.getAttribute("data-page")).toBe(view.page);
    expect(root.querySelector(".omora-page-inner")?.children.length).toBeGreaterThan(0);
  });

  it("和运行时渲染同一份快照得到同一棵 DOM", () => {
    const view = bootView();
    expect(compileSkeleton(view)).toBe(runtimeHtml(view));
  });

  it("状态与端点可指定，默认是未连接", () => {
    const root = parse(compileSkeleton(bootView(), { status: "open", endpoint: "ws://x" }));
    expect(root.querySelector<HTMLElement>(".omora-app")?.dataset.connection).toBe("open");
    expect(root.querySelector(".omora-conn-label")?.textContent).toBe("已连接");
    const status = root.querySelector<HTMLElement>(".omora-conn");
    expect(status?.getAttribute("aria-label")).toBe("已连接");
    expect(status?.title).toBe("ws://x");
  });

  it("没有快照时只编译壳，页面区为空", () => {
    const root = parse(compileSkeleton(null));
    expect(root.querySelector(".omora-app")).not.toBeNull();
    expect(root.querySelector(".omora-page-inner")?.children.length).toBe(0);
    expect(root.querySelectorAll(".omora-shell-nav button")).toHaveLength(0);
  });

  it("同一份快照重复编译结果一致", () => {
    const view = bootView();
    expect(compileSkeleton(view)).toBe(compileSkeleton(view));
  });
});

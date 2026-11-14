// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createSlotRenderer } from "../components/slot_registry";
import { STATIC_ORDER, STATIC_VIEWS } from "../generated/static-view";
import { createEngineFromView } from "../host/engine_sources";
import { slotToNode } from "../renderer/slot_bridge";
import { compileSlotSkeleton } from "./slot-skeleton";

function parse(html: string): HTMLElement {
  const container = document.createElement("div");
  container.innerHTML = html;
  return container;
}

function defaultView(): unknown {
  return STATIC_VIEWS[STATIC_ORDER[0]];
}

/** 运行时画一遍（建引擎 → 桥接 → renderer），作为"编译产物 == 运行时结构"的对照。 */
function runtimeHtml(view: unknown): string {
  const created = createEngineFromView(view);
  if (!created.ok) {
    throw new Error("生成的启动视图应能建引擎: " + JSON.stringify(created.diagnostics));
  }
  const container = document.createElement("div");
  const renderer = createSlotRenderer({
    event: () => undefined,
    loadMedia: () => Promise.reject(new Error("静态骨架不加载媒体")),
    cleanup: () => undefined,
  });
  try {
    renderer.render(slotToNode(created.engine.session.document.root), container);
    return container.innerHTML;
  } finally {
    renderer.dispose();
    created.engine.dispose();
  }
}

describe("compileSlotSkeleton", () => {
  it("编译出母页面壳：window 根、Slot 布局标记、导航入口、页面树", () => {
    const root = parse(compileSlotSkeleton(defaultView()));

    expect(root.querySelector('[data-type="dendro:window"]')).not.toBeNull();
    expect(root.querySelector('[data-dendro-layout="slot"]')).not.toBeNull();
    expect(root.querySelectorAll('[data-type="dendro:page-link"]')).toHaveLength(
      STATIC_ORDER.length,
    );
    expect(root.querySelector('[data-type="dendro:page"]')).not.toBeNull();
  });

  it("和运行时渲染同一份视图得到同一棵 DOM", () => {
    const view = defaultView();

    expect(compileSlotSkeleton(view)).toBe(runtimeHtml(view));
  });

  it("每一页的生成视图都能编译", () => {
    for (const name of STATIC_ORDER) {
      const root = parse(compileSlotSkeleton(STATIC_VIEWS[name]));
      expect(root.querySelector('[data-type="dendro:window"]'), name).not.toBeNull();
    }
  });

  it("视图不合法直接抛，不静默空白", () => {
    expect(() => compileSlotSkeleton({})).toThrow(/不合法/);
  });

  it("同一份视图重复编译结果一致", () => {
    const view = defaultView();
    expect(compileSlotSkeleton(view)).toBe(compileSlotSkeleton(view));
  });
});

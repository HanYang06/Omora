// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { applyData as applyDataUpdate, type DataState } from "../../runtime/data";
import { mountDocumentView } from "./view";
import { DOCUMENT_FIXTURE_PATH } from "./test_fixtures";

const FIXTURE: unknown = JSON.parse(readFileSync(DOCUMENT_FIXTURE_PATH, "utf8"));

function boot(options: Parameters<typeof mountDocumentView>[2] = {}) {
  const container = document.createElement("div");
  const mounted = mountDocumentView(container, FIXTURE, options);
  if (!mounted.ok) {
    throw new Error("fixture 应该能建视图");
  }
  return { container, view: mounted.view };
}

function cards(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(".omora-card")];
}

const UPDATE = {
  kind: "data",
  owner: "ideas",
  source: "ideas.feed",
  revision: 6,
  changes: [
    { kind: "update", key: "42", item: { title: "买牛奶（改）" } },
    {
      kind: "insert",
      key: "7",
      at: 1,
      item: { id: "7", template: "item", title: "录音", meta: "刚刚" },
    },
  ],
};

describe("DocumentView：引擎 ↔ DOM", () => {
  it("从 v2 文档建视图并渲染根树", () => {
    const { container, view } = boot();
    expect(container.querySelector('[data-type="dendro:window"]')).not.toBeNull();
    expect(container.querySelector(".omora-page-link")?.getAttribute("aria-label")).toBe("灵感");
    expect(cards(container)).toHaveLength(1);
    expect(view.engine.metrics.version).toBe(3);
    expect(view.engine.metrics.renders).toBe(1);
    view.dispose();
  });

  it("引擎 apply 成功后视图自动重画，同 id 卡片不重挂", () => {
    const { container, view } = boot();
    const before = cards(container)[0];
    const result = view.engine.applyData(UPDATE);
    expect(result.ok).toBe(true);
    const after = cards(container);
    expect(after).toHaveLength(2);
    expect(after[0]).toBe(before);
    expect(after[0]?.querySelector(".omora-card-title")?.textContent).toBe("买牛奶（改）");
    expect(view.engine.metrics.dataUpdates).toBe(1);
    view.dispose();
  });

  it("权限拒绝时视图不动、引擎会话不动", () => {
    const { container, view } = boot({ requester: { owner: "outsider" } });
    const before = cards(container);
    const result = view.engine.applyData(UPDATE);
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("应当被拒绝");
    }
    expect(result.diagnostics[0]?.code).toBe("E-PERMISSION");
    expect(cards(container)).toHaveLength(1);
    expect(cards(container)[0]).toBe(before[0]);
    expect(view.engine.metrics.rejections).toBe(1);
    view.dispose();
  });

  it("dispose 清空容器、收口账本且幂等", () => {
    const { container, view } = boot();
    const cleaned = vi.fn();
    view.engine.registerCleanup(cleaned);
    expect(view.dispose()).toEqual({ disposed: 1, errors: [] });
    expect(cleaned).toHaveBeenCalledTimes(1);
    expect(container.children).toHaveLength(0);
    expect(view.dispose()).toEqual({ disposed: 0, errors: [] });
    const closed = view.engine.applyData(UPDATE);
    expect(closed.ok).toBe(false);
    expect(closed.ok ? [] : closed.diagnostics[0]?.code).toBe("E-PAYLOAD");
  });

  it("数据更新和直接 applyData 的结果一致（视图不另做一套）", () => {
    const { view } = boot();
    const direct = applyDataUpdate(
      view.engine.session.document,
      view.engine.session.data as unknown as DataState,
      UPDATE,
    );
    const viaView = view.engine.applyData(UPDATE);
    expect(viaView.ok).toBe(true);
    expect(direct.ok ? direct.changed : []).toEqual(viaView.ok ? viaView.changed : []);
    view.dispose();
  });
});

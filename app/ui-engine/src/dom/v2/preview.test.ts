// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { wantsPreview } from "../main";
import { mountPreview, type PreviewHandle } from "./preview";

interface Mounted {
  container: HTMLElement;
  handle: PreviewHandle;
  cleanup: () => void;
}

/** 在 jsdom 里挂一个预览；cleanup 负责 dispose 并把容器摘掉。 */
function mount(): Mounted {
  const container = document.createElement("div");
  document.body.append(container);
  const handle = mountPreview(container);
  return {
    container,
    handle,
    cleanup: () => {
      handle.dispose();
      container.remove();
    },
  };
}

function pageLinks(container: HTMLElement): HTMLButtonElement[] {
  return [...container.querySelectorAll<HTMLButtonElement>(".omora-page-link")];
}

function cardTitles(container: HTMLElement): (string | null)[] {
  return [...container.querySelectorAll<HTMLElement>(".omora-card")].map(
    (card) => card.querySelector(".omora-card-title")?.textContent ?? null,
  );
}

function titleTexts(container: HTMLElement): (string | null)[] {
  return [...container.querySelectorAll<HTMLElement>(".omora-text--title")].map(
    (el) => el.textContent,
  );
}

describe("wantsPreview", () => {
  it("只有 ?engine=v2 走预览：v1 与空查询都留在原路径", () => {
    expect(wantsPreview("?engine=v2")).toBe(true);
    expect(wantsPreview("?engine=v2&debug=1")).toBe(true);
    expect(wantsPreview("?engine=v1")).toBe(false);
    expect(wantsPreview("")).toBe(false);
    expect(wantsPreview("?engine=V2")).toBe(false);
  });
});

describe("mountPreview", () => {
  it("渲染 window / 两个页面入口 / 灵感页工具条与两张卡片", () => {
    const { container, cleanup } = mount();

    const windowEl = container.querySelector<HTMLElement>('[data-type="dendro:window"]');
    expect(windowEl?.className).toBe("omora-row");
    expect(pageLinks(container).map((link) => link.getAttribute("aria-label"))).toEqual([
      "灵感",
      "项目",
    ]);

    // 灵感页工具条：标题 / 「加一张」 / 搜索。
    expect(titleTexts(container)).toEqual(["灵感"]);
    expect(container.querySelector<HTMLButtonElement>(".omora-button")?.textContent).toBe("加一张");
    expect(container.querySelector(".omora-search")).not.toBeNull();

    // 两张卡片按数据顺序物化，标题来自 bind。
    expect(cardTitles(container)).toEqual(["买牛奶", "画画"]);
    cleanup();
  });

  it("点「项目」页链接后主区切到项目页，导航保留", () => {
    const { container, cleanup } = mount();
    const projectsLink = pageLinks(container).find(
      (link) => link.getAttribute("aria-label") === "项目",
    );
    expect(projectsLink).toBeDefined();

    projectsLink?.click();

    expect(cardTitles(container)).toEqual([]);
    expect(titleTexts(container)).toEqual(["项目页"]);
    expect(pageLinks(container)).toHaveLength(2);
    cleanup();
  });

  it("点「加一张」后卡片多一张，已有卡片元素引用不变", () => {
    const { container, cleanup } = mount();
    const before = [...container.querySelectorAll<HTMLElement>(".omora-card")];
    expect(before).toHaveLength(2);

    container.querySelector<HTMLButtonElement>(".omora-button")?.click();

    const after = [...container.querySelectorAll<HTMLElement>(".omora-card")];
    expect(after).toHaveLength(3);
    // 同 id 的卡片必须复用同一个 DOM 元素（不是重建）。
    expect(after[0]).toBe(before[0]);
    expect(after[1]).toBe(before[1]);
    expect(cardTitles(container)).toEqual(["买牛奶", "画画", "新灵感 3"]);
    cleanup();
  });

  it("重复 mount 不叠 DOM，dispose 清空容器", () => {
    const container = document.createElement("div");
    document.body.append(container);

    const first = mountPreview(container);
    expect(container.querySelectorAll('[data-type="dendro:window"]')).toHaveLength(1);

    const second = mountPreview(container);
    expect(first).not.toBe(second);
    expect(container.querySelectorAll('[data-type="dendro:window"]')).toHaveLength(1);

    second.dispose();
    expect(container.children).toHaveLength(0);
    container.remove();
  });
});

describe("?engine=v2 入口接线", () => {
  it("查询串为 engine=v2 时入口动态挂载预览，不建 Connection", async () => {
    const root = document.createElement("div");
    root.id = "root";
    document.body.append(root);
    window.history.replaceState({}, "", "/?engine=v2");
    try {
      // 模块已在文件顶部被 import 过一次：清缓存，让入口按当前 URL / #root 重新启动。
      vi.resetModules();
      await import("../main");
      await vi.waitFor(() => {
        expect(root.querySelector('[data-type="dendro:window"]')).not.toBeNull();
      });
    } finally {
      root.remove();
      window.history.replaceState({}, "", "/");
    }
  });
});

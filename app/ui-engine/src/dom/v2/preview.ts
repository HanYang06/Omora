/**
 * `?engine=v2` 预览入口（S3-e）：内置 v2 文档 → session → 水合 → v2 桥 → DOM。
 *
 * 目的：给 S3-d 的渲染路径一个不依赖 Python 的可见入口，供人工 / 截图验证：
 * - 初始渲染灵感页（window / 两个 page-link / toolbar / 2 张卡片）；
 * - 点导航 page-link 切页：`applyFull` 换整份文档（active 改变、version +1），
 *   再水合、重渲染；
 * - 点「加一张」：`applyData` 往 `ideas.feed` 追加一条（revision +1、全量 items），
 *   再水合、重渲染——同 id 卡片由 renderer 按 id 复用元素；
 * - 其它 handler 一律忽略：预览只演示这两条路径。
 *
 * 不建 Connection、不发消息；`"loadMedia"` 直接 reject（预览不碰媒体）；
 * 重复 mount 同一个容器会先 dispose 上一个实例，不叠 DOM。
 */

import type { CollectionItem } from "../../runtime/collection";
import { applyData, type DataState } from "../../runtime/data";
import { hydrateSession } from "../../runtime/hydrate";
import { applyFull, createSession, type SessionState } from "../../runtime/session";
import { slotToNode } from "./bridge";
import { createSlotRenderer } from "./registry";
import {
  FEED_SOURCE,
  HANDLER_ADD_CARD,
  HANDLER_NAV_IDEAS,
  HANDLER_NAV_PROJECTS,
  INITIAL_FEED_ITEMS,
  INITIAL_FEED_REVISION,
  PAGE_IDEAS,
  PAGE_PROJECTS,
  previewDocument,
  type PreviewFeed,
} from "./preview_document";

/** 预览实例句柄：dispose 卸载整棵渲染树。 */
export interface PreviewHandle {
  dispose(): void;
}

/** 每个容器只保留一个预览实例：重复 mount 时先撤旧的，避免叠 DOM。 */
const activeMounts = new WeakMap<HTMLElement, PreviewHandle>();

function cloneFeed(): PreviewFeed {
  return {
    revision: INITIAL_FEED_REVISION,
    items: INITIAL_FEED_ITEMS.map((item) => ({ ...item })),
  };
}

/** 水合；失败只可能是内置文档/数据违反运行时不变量，直接抛（预览不要静默空白）。 */
function mustHydrate(session: SessionState): SessionState {
  const hydrated = hydrateSession(session);
  if (!hydrated.ok) {
    throw new Error("v2 预览水合失败：" + JSON.stringify(hydrated.diagnostics));
  }
  return hydrated.session;
}

function startSession(page: string, feed: PreviewFeed, version: number): SessionState {
  const created = createSession(previewDocument(page, feed, version));
  if (!created.ok) {
    throw new Error("v2 预览文档不合法：" + JSON.stringify(created.diagnostics));
  }
  return mustHydrate(created.session);
}

/**
 * 在 `container` 上挂一个 v2 预览：建会话 → 水合 → 用 v2 桥渲染。
 *
 * 返回句柄只负责卸载；预览内部状态（当前活动页、feed 数据、文档版本）留在闭包里，
 * 所有交互都通过 DOM 事件 → handler id → 闭包函数完成，不依赖 Python。
 */
export function mountPreview(container: HTMLElement): PreviewHandle {
  activeMounts.get(container)?.dispose();

  let page = PAGE_IDEAS;
  let feed = cloneFeed();
  let session = startSession(page, feed, 1);

  const renderer = createSlotRenderer({
    event: (handler) => dispatch(handler),
    loadMedia: () => Promise.reject(new Error("v2 预览不加载媒体")),
    cleanup: () => undefined,
  });

  function render(): void {
    renderer.render(slotToNode(session.document.root), container);
  }

  /** 切页 = 全量替换：目标页子树 + active + version+1，然后水合重渲染。 */
  function switchPage(target: string): void {
    if (target === page) {
      return;
    }
    const next = applyFull(session, previewDocument(target, feed, session.document.version + 1));
    if (!next.ok) {
      console.error("[omora] v2 预览切页失败:", next.diagnostics);
      return;
    }
    page = target;
    session = mustHydrate(next.session);
    render();
  }

  /** 加一张 = 数据全量追加：revision +1，旧条目 id 不变，渲染层按 id 复用元素。 */
  function addCard(): void {
    const id = String(feed.items.length + 1);
    const items: CollectionItem[] = [
      ...feed.items,
      { id, template: "item", title: "新灵感 " + id, meta: "刚刚" },
    ];
    const nextFeed: PreviewFeed = { revision: feed.revision + 1, items };
    const currentData: DataState = { [FEED_SOURCE]: feed };
    const applied = applyData(session.document, currentData, {
      kind: "data",
      owner: "ideas",
      source: FEED_SOURCE,
      revision: nextFeed.revision,
      items,
    });
    if (!applied.ok) {
      console.error("[omora] v2 预览追加卡片失败:", applied.diagnostics);
      return;
    }
    feed = nextFeed;
    session = mustHydrate({
      ...session,
      document: applied.document,
      data: applied.data,
    });
    render();
  }

  function dispatch(handler: string): void {
    if (handler === HANDLER_NAV_IDEAS) {
      switchPage(PAGE_IDEAS);
    } else if (handler === HANDLER_NAV_PROJECTS) {
      switchPage(PAGE_PROJECTS);
    } else if (handler === HANDLER_ADD_CARD) {
      addCard();
    }
  }

  const handle: PreviewHandle = {
    dispose() {
      if (activeMounts.get(container) === handle) {
        activeMounts.delete(container);
      }
      renderer.dispose();
    },
  };
  activeMounts.set(container, handle);
  render();
  return handle;
}

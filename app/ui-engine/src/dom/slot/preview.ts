/**
 * `?engine=slot` 预览入口（S3-e / S4 dogfood）：内置 Slot 文档 → EngineRuntime → DocumentView → DOM。
 *
 * 目的：给 Slot 渲染路径一个不依赖 Python 的可见入口，并让 S4 的宿主入口
 * `mountDocumentView`（createEngine + hydrate + 渲染 + 变更通知）在真实入口上跑一遍：
 * - 初始渲染灵感页（window / 两个 page-link / toolbar / 2 张卡片）；
 * - 点导航 page-link 切页：`engine.applyFull` 换整份文档（active 改变、version +1），
 *   视图收到引擎通知自动重画；
 * - 点「加一张」：`engine.applyData` 往 `ideas.feed` 追加一条（revision +1、全量 items），
 *   视图自动重画——同 id 卡片由 renderer 按 id 复用元素；
 * - 其它 handler 一律忽略：预览只演示这两条路径。
 *
 * 预览自己不再持有会话 / 渲染器：状态都在引擎里，视图只把引擎的当前会话画到容器上。
 * 不建 Connection、不发消息；`loadMedia` 直接 reject（预览不碰媒体）；
 * 重复 mount 同一个容器会先 dispose 上一个实例，不叠 DOM；建视图失败直接抛错
 * （预览不要静默空白）。
 */

import type { CollectionItem } from "../../engine/collections/collection";
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
import { mountDocumentView, type DocumentView } from "./view";

/** 预览实例句柄：dispose 卸载整棵渲染树（引擎账本一并收口）。 */
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

/** 建引擎 + 视图；内置文档 / 数据违反运行时不变量时直接抛（预览不要静默空白）。 */
function mountView(
  container: HTMLElement,
  feed: PreviewFeed,
  onEvent: (handler: string) => void,
): DocumentView {
  const mounted = mountDocumentView(container, previewDocument(PAGE_IDEAS, feed, 1), {
    onEvent: (handler) => onEvent(handler),
    loadMedia: () => Promise.reject(new Error("Slot 预览不加载媒体")),
  });
  if (!mounted.ok) {
    throw new Error("Slot 预览建视图失败：" + JSON.stringify(mounted.diagnostics));
  }
  return mounted.view;
}

/**
 * 在 `container` 上挂一个 Slot 预览：建引擎 + 视图 → 交互经 DOM 事件 → handler id → 闭包。
 *
 * 返回句柄只负责卸载；预览维护的 feed 快照留在闭包里，文档 / 会话 / 渲染全部交给引擎
 * 与视图：切页只提交一次 applyFull，加卡只提交一次全量 items 的 applyData。
 */
export function mountPreview(container: HTMLElement): PreviewHandle {
  activeMounts.get(container)?.dispose();

  let feed = cloneFeed();

  /** 切页 = 全量替换：目标页子树 + active + version+1；视图由引擎通知重画。 */
  function switchPage(target: string): void {
    if (target === view.engine.session.active) {
      return;
    }
    const version = view.engine.session.document.version + 1;
    const applied = view.engine.applyFull(previewDocument(target, feed, version));
    if (!applied.ok) {
      console.error("[omora] Slot 预览切页失败:", applied.diagnostics);
    }
  }

  /** 加一张 = 数据全量追加：revision +1，旧条目 id 不变，渲染层按 id 复用元素。 */
  function addCard(): void {
    const id = String(feed.items.length + 1);
    const items: CollectionItem[] = [
      ...feed.items,
      { id, template: "item", title: "新灵感 " + id, meta: "刚刚" },
    ];
    const nextFeed: PreviewFeed = { revision: feed.revision + 1, items };
    const applied = view.engine.applyData({
      kind: "data",
      owner: "ideas",
      source: FEED_SOURCE,
      revision: nextFeed.revision,
      items,
    });
    if (!applied.ok) {
      console.error("[omora] Slot 预览追加卡片失败:", applied.diagnostics);
      return;
    }
    feed = nextFeed;
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

  // 事件回调先写好、视图后建：挂载渲染期间不派发事件，所以回调里读 view 是安全的。
  const view = mountView(container, feed, dispatch);

  const handle: PreviewHandle = {
    dispose() {
      if (activeMounts.get(container) === handle) {
        activeMounts.delete(container);
      }
      view.dispose();
    },
  };
  activeMounts.set(container, handle);
  return handle;
}

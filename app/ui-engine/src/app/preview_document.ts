/**
 * `?engine=slot` 预览入口的内置示例文档（S3-e）：手写在 TS 里，不 import 测试 fixture。
 *
 * 只为演示「session → 水合 → Slot 桥 → DOM」这条路径，形状如下：
 *
 *   dendro.window（row）
 *   ├─ dendro.window.nav（column，56px）
 *   │  两个 dendro:page-link：灵感（nav:ideas）/ 项目（nav:projects）
 *   └─ dendro.window.page（column，capacity one）
 *      ├─ page.ideas：toolbar（row：标题 text + 「加一张」button + search）+ feed slot
 *      └─ page.projects：一条标题 text
 *
 * feed 是集合 slot（source = `ideas.feed`，按 `id` 选模板 `item` = ideas:card），
 * data 里放同一份条目投影——物化交给 `engine/updates/hydrate.ts`，这里只写文档。
 *
 * 整份文档只带**当前活动页**那棵子树（和线上全量文档一致：非活动页不在树上），
 * 所以切页由 preview.ts 用 `applyFull` 换整份文档，version 由调用方给（切页 +1）。
 */

import {
  DOCUMENT_SCHEMA,
  type Collection,
  type SlotDocument,
  type Layout,
  type PageEntry,
  type SlotNode,
} from "../contract/document";
import type { CollectionItem } from "../engine/collections/collection";

/** 页面 id（与 pages / active 对齐）。 */
export const PAGE_IDEAS = "page.ideas";
export const PAGE_PROJECTS = "page.projects";

/** 集合 slot id 同时是数据 source（与共享 fixture 的命名一致）。 */
export const FEED_SOURCE = "ideas.feed";

/** 预览自己的 handler id：preview.ts 按这些 id 分发，其它一律忽略。 */
export const HANDLER_NAV_IDEAS = "nav:ideas";
export const HANDLER_NAV_PROJECTS = "nav:projects";
export const HANDLER_ADD_CARD = "ideas:add";

const WINDOW_ID = "dendro.window";
const NAV_SLOT_ID = "dendro.window.nav";
const PAGE_SLOT_ID = "dendro.window.page";
const TEMPLATE_ID = "tpl.ideas.item";

/** 预览用的页面侧表（导航两个入口）。 */
export const PREVIEW_PAGES: readonly PageEntry[] = [
  { id: PAGE_IDEAS, label: "灵感", route: "/ideas", owner: "ideas", icon: "ideas" },
  { id: PAGE_PROJECTS, label: "项目", route: "/projects", owner: "projects", icon: "projects" },
];

/** 预览初始的 2 张卡片；「加一张」从这份数据上追加。 */
export const INITIAL_FEED_ITEMS: readonly CollectionItem[] = [
  { id: "1", template: "item", title: "买牛奶", meta: "刚刚" },
  { id: "2", template: "item", title: "画画", meta: "昨天" },
];

/** 初始数据 revision（与线上 data payload 的 revision 同义）。 */
export const INITIAL_FEED_REVISION = 1;

/** 预览维护的 feed 数据快照。 */
export interface PreviewFeed {
  revision: number;
  items: CollectionItem[];
}

interface SlotInit {
  id: string;
  kind: string;
  owner: string;
  props?: Record<string, unknown>;
  children?: SlotNode[];
  layout?: Layout;
  events?: Record<string, string>;
  bind?: Record<string, string>;
  collection?: Collection;
}

function slotOf(init: SlotInit): SlotNode {
  const slot: SlotNode = {
    id: init.id,
    kind: init.kind,
    owner: init.owner,
    props: init.props ?? {},
    children: init.children ?? [],
  };
  if (init.layout !== undefined) {
    slot.layout = init.layout;
  }
  if (init.events !== undefined) {
    slot.events = init.events;
  }
  if (init.bind !== undefined) {
    slot.bind = init.bind;
  }
  if (init.collection !== undefined) {
    slot.collection = init.collection;
  }
  return slot;
}

function pageLink(id: string, label: string, icon: string, handler: string): SlotNode {
  return slotOf({
    id,
    kind: "dendro:page-link",
    owner: "dendro",
    props: { label, icon },
    events: { click: handler },
  });
}

/** 图标栏：两个页面入口，纵向排列。 */
function navSlot(): SlotNode {
  return slotOf({
    id: NAV_SLOT_ID,
    kind: "dendro:slot",
    owner: "dendro",
    layout: { flow: "column", capacity: "many", size: { width: 56 } },
    children: [
      pageLink("nav.ideas", "灵感", "ideas", HANDLER_NAV_IDEAS),
      pageLink("nav.projects", "项目", "projects", HANDLER_NAV_PROJECTS),
    ],
  });
}

/** 灵感页工具条：标题 + 「加一张」 + 搜索。 */
function ideasToolbar(): SlotNode {
  return slotOf({
    id: "ideas.toolbar",
    kind: "dendro:slot",
    owner: "ideas",
    layout: { flow: "row", capacity: "many", align: "center" },
    children: [
      slotOf({
        id: "ideas.title",
        kind: "dendro:text",
        owner: "ideas",
        props: { text: "灵感", kind: "title" },
      }),
      slotOf({
        id: "ideas.add",
        kind: "dendro:button",
        owner: "ideas",
        props: { text: "加一张" },
        events: { click: HANDLER_ADD_CARD },
      }),
      slotOf({
        id: "ideas.search",
        kind: "dendro:search",
        owner: "ideas",
        props: { placeholder: "搜索灵感…" },
      }),
    ],
  });
}

/** 集合模板：卡片标题 / 副标题从条目数据绑定。 */
function feedTemplate(): SlotNode {
  return slotOf({
    id: TEMPLATE_ID,
    kind: "ideas:card",
    owner: "ideas",
    bind: { title: "item.title", meta: "item.meta" },
  });
}

/** 卡片流：按 `ideas.feed` 的数据实例化，模板本身不进树。 */
function feedSlot(): SlotNode {
  return slotOf({
    id: FEED_SOURCE,
    kind: "dendro:slot",
    owner: "ideas",
    layout: { flow: "column", capacity: "many" },
    collection: {
      source: FEED_SOURCE,
      key: "id",
      templates: { item: feedTemplate() },
      select: "template",
    },
  });
}

function ideasPage(): SlotNode {
  return slotOf({
    id: PAGE_IDEAS,
    kind: "dendro:page",
    owner: "ideas",
    layout: { flow: "column", capacity: "many" },
    children: [ideasToolbar(), feedSlot()],
  });
}

function projectsPage(): SlotNode {
  return slotOf({
    id: PAGE_PROJECTS,
    kind: "dendro:page",
    owner: "projects",
    layout: { flow: "column", capacity: "many" },
    children: [
      slotOf({
        id: "projects.title",
        kind: "dendro:text",
        owner: "projects",
        props: { text: "项目页", kind: "title" },
      }),
      slotOf({
        id: "projects.hint",
        kind: "dendro:text",
        owner: "projects",
        props: { text: "这里是项目列表占位。", kind: "muted" },
      }),
    ],
  });
}

function pageFor(active: string): SlotNode {
  if (active === PAGE_IDEAS) {
    return ideasPage();
  }
  if (active === PAGE_PROJECTS) {
    return projectsPage();
  }
  throw new Error("内置预览文档没有页面: " + active);
}

/**
 * 构造某个活动页的完整 Slot 文档。
 *
 * 每次返回全新对象（页面子树、data 条目都重新建），调用方可以直接交给
 * `createSession` / `applyFull`，不会与上一份文档共享可变状态。
 */
export function previewDocument(active: string, feed: PreviewFeed, version: number): SlotDocument {
  return {
    schema: DOCUMENT_SCHEMA,
    document: slotOf({
      id: WINDOW_ID,
      kind: "dendro:window",
      owner: "dendro",
      layout: { flow: "row", capacity: "many" },
      children: [
        navSlot(),
        slotOf({
          id: PAGE_SLOT_ID,
          kind: "dendro:slot",
          owner: "dendro",
          layout: { flow: "column", capacity: "one", size: { width: "fill" } },
          children: [pageFor(active)],
        }),
      ],
    }),
    pages: PREVIEW_PAGES.map((page) => ({ ...page })),
    active,
    data: {
      [FEED_SOURCE]: {
        revision: feed.revision,
        items: feed.items.map((item) => ({ ...item })),
      },
    },
    version,
  };
}

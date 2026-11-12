import type { Layout } from "./document";

/**
 * 界面节点与页面快照。形状是合同：Python 的 sdk/ui.py 产出的就是它。
 *
 * props 对渲染引擎不透明；可调用字段（如 on_click）已经序列化成 handler id。
 */
export interface Node {
  type: string;
  props: Record<string, unknown>;
  children: Node[];
  /** v1.5 加字段：稳定身份；缺省时渲染端按父路径+位置协调。 */
  id?: string;
  /** v1.5 加字段：事件名 → handler id；kind 优先读它，再回退 props.on_*。 */
  events?: Record<string, string>;
  /**
   * v2 桥加字段：Slot 的 layout 描述符（S3-d）。v1 kind 不读它，
   * v2 原生 kind 按 layout.flow 决定容器 class；渲染器只当数据搬运。
   */
  layout?: Layout;
}

export type EventHandler = (handler: string, payload?: Record<string, unknown>) => void;

/** 媒体服务取回来的一件东西：mime + base64。 */
export interface MediaData {
  mime: string;
  data: string;
}

export type MediaResolver = (media: string) => Promise<MediaData>;

/**
 * 一份贡献：某个插件交来的一棵树 + 落点键 + 顺序（协议 §2）。
 *
 * 归属打在贡献上，不逐节点盖戳：里面所有节点都归 owner。
 */
export interface Contribution {
  owner: string;
  target: string;
  op: "replace" | "before" | "after" | "append";
  order?: number;
  seq?: number;
  tree: Node;
}

/** 导航里的一项：页面登记时给的 name / label / 可选图标 / 可选数量。 */
export interface PageEntry {
  name: string;
  label: string;
  /** 图标栏用的词表名字；页面没给就用 dot。 */
  icon?: string;
  /** 页面自带的 SVG 路径数据；给了就画它，不用改引擎的词表。 */
  glyph?: string;
  count?: number;
}

/**
 * 全量快照：壳需要的一切。协议 §6。
 *
 * version 是页面自己的单调计数（由 ui 插件给）：补丁带 base，只有 base 等于
 * 自己这份的 version 才应用；对不上就重新要全量。
 */
export interface Snapshot {
  pages: PageEntry[];
  page: string;
  meta: string;
  content: Node;
  version: number;
  /** 别的插件交来的贡献；合成后才画。没有就是空。 */
  contributions?: Contribution[];
  /** 这一页要订的推送 topic；没有就只订视图通道。 */
  topics?: string[];
}

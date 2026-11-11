/**
 * 界面节点与页面快照。形状是合同：Python 的 sdk/ui.py 产出的就是它。
 *
 * props 对渲染引擎不透明；可调用字段（如 on_click）已经序列化成 handler id。
 */
export interface Node {
  type: string;
  props: Record<string, unknown>;
  children: Node[];
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
}

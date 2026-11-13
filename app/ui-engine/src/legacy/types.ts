/**
 * 旧快照协议模型（legacy）：贡献、页面登记与全量快照。
 *
 * 这是 legacy 渲染路径的线上形状（协议 §2 / §6）；与 Slot 文档无关，随 legacy
 * 路径一起删除。Node 是渲染层契约（renderer/types），legacy → renderer 允许。
 */

import type { Node } from "../renderer/types";

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

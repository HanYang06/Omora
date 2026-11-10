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

/** 导航里的一项：页面登记时给的 name / label / 可选图标 / 可选数量。 */
export interface PageEntry {
  name: string;
  label: string;
  /** 图标栏用的词表名字；页面没给就用 dot。 */
  icon?: string;
  count?: number;
}

/** ui.render / ui.event 的返回值：壳需要的一切。 */
export interface Snapshot {
  pages: PageEntry[];
  page: string;
  meta: string;
  content: Node;
}

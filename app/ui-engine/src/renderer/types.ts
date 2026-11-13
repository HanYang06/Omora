import type { Layout } from "../contract/document";
import type { JsonObject, MediaData } from "../contract/protocol";

/**
 * 渲染节点契约：legacy Node 与 Slot 桥接后的统一形状。
 *
 * props 对渲染引擎不透明；可调用字段（如 on_click）已经序列化成 handler id。
 */
export interface Node {
  type: string;
  props: Record<string, unknown>;
  children: Node[];
  /** legacy 加字段：稳定身份；缺省时渲染端按父路径+位置协调。 */
  id?: string;
  /** legacy 加字段：事件名 → handler id；kind 优先读它，再回退 props.on_*。 */
  events?: Record<string, string>;
  /**
   * Slot 桥加字段：Slot 的 layout 描述符（S3-d）。legacy kind 不读它，
   * Slot 原生 kind 按 layout.flow 决定容器 class；渲染器只当数据搬运。
   */
  layout?: Layout;
}

export type EventHandler = (handler: string, payload?: Record<string, unknown>) => void;

/** kind 唯一的运行时出口：发事件、取媒体、登记卸载清理。 */
export interface RenderContext {
  event(handler: string, payload?: JsonObject): void;
  loadMedia(media: string): Promise<MediaData>;
  cleanup(dispose: () => void): void;
}

/** 一个组件 kind 的 DOM 实现。renderer 负责 children 与元素生命周期。 */
export interface Kind {
  create(node: Node, ctx: RenderContext): HTMLElement;
  update?(el: HTMLElement, node: Node, ctx: RenderContext): void;
  destroy?(el: HTMLElement): void;
  /**
   * 每个 children 的挂载点，按子节点下标映射；缺省 [el]。
   * 返回 null 表示这个 kind 不接受 children。缺的项回退到最后一个 host。
   */
  childrenHosts?(el: HTMLElement, node: Node): (HTMLElement | null)[] | null;
}

export type KindRegistry = Readonly<Record<string, Kind>>;
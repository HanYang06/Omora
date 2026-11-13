import type { JsonObject } from "../contract/protocol";
import type { MediaData, Node } from "../core/types";

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

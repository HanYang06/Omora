import type { JsonObject } from "../core/protocol";
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
  /** children 的挂载点；缺省 el 本身。 */
  childrenHost?(el: HTMLElement, node: Node): HTMLElement | null;
}

export type KindRegistry = Readonly<Record<string, Kind>>;

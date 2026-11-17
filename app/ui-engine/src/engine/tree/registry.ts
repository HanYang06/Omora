/**
 * 渲染器注册表：kind → NodeRenderer 工厂。runtime 只按 kind 查，一个 kind 一份实现。
 * 注册是覆盖式的：后注册的同名 kind 生效（测试替身 / 宿主替换用）。
 */

import type { NodeRendererFactory, RendererRegistry } from "./types";

export class NodeRendererRegistry implements RendererRegistry {
  private readonly factories = new Map<string, NodeRendererFactory>();

  constructor(entries: Record<string, NodeRendererFactory> = {}) {
    for (const [kind, factory] of Object.entries(entries)) {
      this.register(kind, factory);
    }
  }

  /** 注册（或覆盖）一个 kind 的渲染器工厂。 */
  register(kind: string, factory: NodeRendererFactory): this {
    if (kind === "") {
      throw new Error("kind 不能为空");
    }
    this.factories.set(kind, factory);
    return this;
  }

  get(kind: string): NodeRendererFactory | undefined {
    return this.factories.get(kind);
  }

  has(kind: string): boolean {
    return this.factories.has(kind);
  }

  get size(): number {
    return this.factories.size;
  }
}

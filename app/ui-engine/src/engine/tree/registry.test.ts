import { describe, expect, it } from "vitest";
import { NodeRendererRegistry } from "./registry";
import type { NodeRendererFactory } from "./types";

function rendererFactory(): NodeRendererFactory {
  return () => ({
    mount: () => ({ output: null, host: null }),
    update: () => undefined,
    unmount: () => undefined,
  });
}

describe("NodeRendererRegistry", () => {
  it("按 kind 返回注册的工厂，未知 kind 返回 undefined", () => {
    const factory = rendererFactory();
    const registry = new NodeRendererRegistry();
    registry.register("column", factory);

    expect(registry.get("column")).toBe(factory);
    expect(registry.has("column")).toBe(true);
    expect(registry.get("button")).toBeUndefined();
    expect(registry.has("button")).toBe(false);
    expect(registry.size).toBe(1);
  });

  it("同名 kind 后注册的工厂覆盖前一个", () => {
    const first = rendererFactory();
    const second = rendererFactory();
    const registry = new NodeRendererRegistry();

    registry.register("text", first).register("text", second);

    expect(registry.get("text")).toBe(second);
    expect(registry.size).toBe(1);
  });

  it("构造器接收初始注册表；空 kind 直接拒绝", () => {
    const factory = rendererFactory();

    const registry = new NodeRendererRegistry({ app: factory });

    expect(registry.get("app")).toBe(factory);
    expect(() => registry.register("", factory)).toThrow("kind 不能为空");
  });
});

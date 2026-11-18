import { describe, expect, it } from "vitest";
import { compileBootSkeletonInNode } from "../../src/build/node";

describe("compileBootSkeletonInNode", () => {
  it("在 Node 里立临时 DOM 编译启动骨架", async () => {
    const html = compileBootSkeletonInNode();
    expect(html).toContain('data-type="dendro:window"');
    expect(html).toContain('data-dendro-layout="slot"');
    expect(html).toContain('data-type="dendro:page-link"');
  });

  it("跑完还原全局：不把 document / window 留在 Node 里", async () => {
    const hadDocument = "document" in globalThis;
    const hadWindow = "window" in globalThis;
    compileBootSkeletonInNode();
    expect("document" in globalThis).toBe(hadDocument);
    expect("window" in globalThis).toBe(hadWindow);
  });

  it("两次编译一致", async () => {
    expect(compileBootSkeletonInNode()).toBe(compileBootSkeletonInNode());
  });
});

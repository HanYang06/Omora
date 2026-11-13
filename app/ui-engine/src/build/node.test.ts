import { describe, expect, it } from "vitest";
import { compileBootSkeletonInNode } from "./node";

describe("compileBootSkeletonInNode", () => {
  it("在 Node 里立临时 DOM 编译启动骨架", async () => {
    const html = compileBootSkeletonInNode();
    expect(html).toContain('class="omora-app"');
    expect(html).toContain("omora-shell-nav");
    expect(html).toContain('data-connection="idle"');
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

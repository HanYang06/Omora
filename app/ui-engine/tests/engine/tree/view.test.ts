import { describe, expect, it } from "vitest";
import { TreeView } from "../../../src/engine/tree/view";
import { exampleDocument, fakeHarness } from "./test_fixtures";

describe("TreeView", () => {
  it("固定宿主与注册表并转发 mount / replace / unmount / dispose", () => {
    const harness = fakeHarness();
    const view = new TreeView({ host: harness.host, renderers: harness.renderers });
    const first = exampleDocument();

    expect(view.mount(first).ok).toBe(true);
    expect(view.mounted).toBe(true);
    expect(view.document).toBe(first);

    const next = exampleDocument();
    expect(view.replace(next).ok).toBe(true);
    expect(view.document).toBe(next);

    view.unmount();
    expect(view.mounted).toBe(false);
    expect(view.document).toBeNull();

    view.dispose();
    expect(view.disposed).toBe(true);
    const after = view.mount(exampleDocument());
    expect(after.ok).toBe(false);
    expect(view.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["E-TREE-DISPOSED"]);
  });

  it("坏文档经 view 挂载失败：诊断可从 view 读到，宿主保持干净", () => {
    const harness = fakeHarness();
    const view = new TreeView({ host: harness.host, renderers: harness.renderers });
    const bad = exampleDocument();
    delete (bad.root as Record<string, unknown>).layout;

    const result = view.mount(bad);

    expect(result.ok).toBe(false);
    expect(view.mounted).toBe(false);
    expect(view.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["E-TREE-PAYLOAD"]);
    expect(harness.rendererCalls).toEqual([]);
    expect(harness.hostCalls).toEqual([]);
  });
});

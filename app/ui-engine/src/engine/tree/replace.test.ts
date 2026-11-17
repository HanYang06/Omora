import { describe, expect, it } from "vitest";
import { TreeRuntime, type TreeMountResult } from "./runtime";
import {
  EXAMPLE_ROOT_ID,
  appendRootChild,
  exampleDocument,
  fakeHarness,
  invalidDocument,
  nodeById,
  removeNode,
  type FakeHarness,
  type FakeHarnessOptions,
  type JsonRecord,
} from "./test_fixtures";

const ROOT = EXAMPLE_ROOT_ID;
const NAV = "0a1b2c3d4e5f6a7b";
const NAV_ITEM_A = "1c2d3e4f5a6b7c8d";
const NAV_ITEM_B = "2e3f4a5b6c7d8e9f";
const MAIN = "3a4b5c6d7e8f9a0b";
const PAGE = "4b5c6d7e8f9a0b1c";
const TITLE = "5c6d7e8f9a0b1c2d";
const QUERY = "6d7e8f9a0b1c2d3e";
const FEED = "7e8f9a0b1c2d3e4f";
const CARD_A = "8f9a0b1c2d3e4f5a";
const MEDIA = "9a0b1c2d3e4f5a6b";
const CARD_B = "0b1c2d3e4f5a6b7c";

const PRE_ORDER = [
  ROOT,
  NAV,
  NAV_ITEM_A,
  NAV_ITEM_B,
  MAIN,
  PAGE,
  TITLE,
  QUERY,
  FEED,
  CARD_A,
  MEDIA,
  CARD_B,
];

const POST_ORDER = [
  NAV_ITEM_A,
  NAV_ITEM_B,
  NAV,
  TITLE,
  QUERY,
  MEDIA,
  CARD_A,
  CARD_B,
  FEED,
  PAGE,
  MAIN,
  ROOT,
];

const ADDED = "1111111111111111";

function harnessRuntime(options?: FakeHarnessOptions): {
  harness: FakeHarness;
  runtime: TreeRuntime;
} {
  const harness = fakeHarness(options);
  const runtime = new TreeRuntime({ host: harness.host, renderers: harness.renderers });
  return { harness, runtime };
}

function mountedExample(options?: FakeHarnessOptions): {
  harness: FakeHarness;
  runtime: TreeRuntime;
  document: JsonRecord;
} {
  const { harness, runtime } = harnessRuntime(options);
  const document = exampleDocument();
  const result = runtime.mount(document);
  if (!result.ok) {
    throw new Error("示例文档应能挂载: " + JSON.stringify(result.diagnostics));
  }
  harness.resetCalls();
  return { harness, runtime, document };
}

function codesOf(result: TreeMountResult): string[] {
  if (result.ok) {
    throw new Error("预期挂载失败，实际成功");
  }
  return result.diagnostics.map((diagnostic) => diagnostic.code);
}

function rendererIds(harness: FakeHarness, op: "mount" | "update" | "unmount"): string[] {
  return harness.rendererCalls.filter((call) => call.op === op).map((call) => call.id);
}

describe("TreeRuntime.replace", () => {
  it("按稳定 id 复用同 kind 的渲染器：保留节点 update，新节点 mount，消失节点 unmount", () => {
    const { harness, runtime } = mountedExample();
    const next = exampleDocument();
    (nodeById(next, TITLE).settings as JsonRecord).text = "changed";
    removeNode(next, MEDIA);
    appendRootChild(next, ADDED, "text", 30);

    const result = runtime.replace(next);

    expect(result.ok).toBe(true);
    expect(runtime.document).toBe(next);
    expect(harness.rendererOps(TITLE)).toEqual(["update"]);
    expect(harness.rendererOps(CARD_A)).toEqual(["update"]);
    expect(harness.rendererOps(MEDIA)).toEqual(["unmount"]);
    expect(harness.rendererOps(ADDED)).toEqual(["mount"]);
    // 根 id 不变：根宿主走 update 不重挂；新节点按 layout 顺序挂进根的子宿主。
    expect(harness.hostOps(ROOT)).toEqual(["update"]);
    expect(harness.hostOps(ADDED)).toEqual(["mount"]);
    expect(harness.hostOps(MEDIA)).toEqual(["unmount"]);
    // 复用节点只 update，没有被重新 mount。
    expect(rendererIds(harness, "mount")).toEqual([ADDED]);
    expect(rendererIds(harness, "update")).toHaveLength(PRE_ORDER.length - 1);
  });

  it("替换成坏文档：旧树与宿主保持不动，一次渲染器 / 宿主调用都不发生", () => {
    const { harness, runtime, document } = mountedExample();
    const badRoot = exampleDocument();
    (badRoot.root as JsonRecord).kind = "column";

    const shapeResult = runtime.replace(badRoot);
    const duplicateResult = runtime.replace(invalidDocument("duplicate-id.json"));

    expect(codesOf(shapeResult)).toContain("E-TREE-ROOT");
    expect(codesOf(duplicateResult)).toEqual(["E-TREE-DUP-ID"]);
    expect(runtime.mounted).toBe(true);
    expect(runtime.document).toBe(document);
    expect(harness.rendererCalls).toEqual([]);
    expect(harness.hostCalls).toEqual([]);
  });

  it("移除一棵子树：后代先于父卸载，宿主只摘顶层节点，兄弟继续保留", () => {
    const { harness, runtime } = mountedExample();
    const next = exampleDocument();
    removeNode(next, MAIN);

    const result = runtime.replace(next);

    expect(result.ok).toBe(true);
    expect(rendererIds(harness, "unmount")).toEqual([
      TITLE,
      QUERY,
      MEDIA,
      CARD_A,
      CARD_B,
      FEED,
      PAGE,
      MAIN,
    ]);
    expect(harness.hostCalls.filter((call) => call.op === "unmount")).toEqual([
      { op: "unmount", id: MAIN, host: "h:" + ROOT },
    ]);
    expect(harness.rendererOps(NAV_ITEM_A)).toEqual(["update"]);
    expect(harness.rendererOps(MAIN)).toEqual(["unmount"]);
  });

  it("同 id 换 kind：重新 mount 新渲染器并清退旧渲染器，不走 update", () => {
    const { harness, runtime } = mountedExample();
    const next = exampleDocument();
    nodeById(next, TITLE).kind = "button";

    const result = runtime.replace(next);

    expect(result.ok).toBe(true);
    expect(harness.rendererOps(TITLE)).toEqual(["mount", "unmount"]);
    expect(harness.hostOps(TITLE)).toEqual(["unmount", "mount"]);
  });

  it("替换时渲染器 update 抛错：失败关闭，旧树全部卸载，runtime 回到未挂载", () => {
    const { harness, runtime } = mountedExample({ failUpdateOn: CARD_A });
    const next = exampleDocument();
    (nodeById(next, TITLE).settings as JsonRecord).text = "changed";

    const result = runtime.replace(next);

    expect(codesOf(result)).toEqual(["E-TREE-RENDER"]);
    expect(runtime.mounted).toBe(false);
    expect(runtime.document).toBeNull();
    expect(rendererIds(harness, "unmount")).toEqual(POST_ORDER);
    expect(harness.hostCalls.filter((call) => call.op === "unmount")).toEqual([
      { op: "unmount", id: ROOT, host: "root" },
    ]);
    // 收口后还能重新挂载。
    expect(runtime.mount(exampleDocument()).ok).toBe(true);
  });

  it("清退旧节点时单个 unmount 抛错：结果仍成功，失败进诊断，其余节点照常卸载", () => {
    const { harness, runtime } = mountedExample({ failUnmountOn: CARD_A });
    const next = exampleDocument();
    removeNode(next, MAIN);

    const result = runtime.replace(next);

    expect(result.ok).toBe(true);
    expect(runtime.document).toBe(next);
    expect(runtime.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["E-TREE-RENDER"]);
    expect(runtime.diagnostics[0]?.path).toBe("/root/layout/1/layout/0/layout/2/layout/0");
    expect(rendererIds(harness, "unmount")).toEqual([
      TITLE,
      QUERY,
      MEDIA,
      CARD_B,
      FEED,
      PAGE,
      MAIN,
    ]);
  });

  it("未挂载时 replace 等同首次 mount", () => {
    const { harness, runtime } = harnessRuntime();

    const result = runtime.replace(exampleDocument());

    expect(result.ok).toBe(true);
    expect(runtime.mounted).toBe(true);
    expect(rendererIds(harness, "mount")).toEqual(PRE_ORDER);
  });
});

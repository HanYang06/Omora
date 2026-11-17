import { describe, expect, it } from "vitest";
import { TreeRuntime, type TreeMountResult } from "./runtime";
import {
  EXAMPLE_ROOT_ID,
  exampleDocument,
  fakeHarness,
  invalidDocument,
  nodeById,
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

/** 共享示例的前序（= 挂载顺序）。 */
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

/** 共享示例的后序（= 卸载顺序，子先父后）。 */
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

function harnessRuntime(options?: FakeHarnessOptions): {
  harness: FakeHarness;
  runtime: TreeRuntime;
} {
  const harness = fakeHarness(options);
  const runtime = new TreeRuntime({ host: harness.host, renderers: harness.renderers });
  return { harness, runtime };
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

describe("TreeRuntime.mount", () => {
  it("挂载示例文档：按前序建渲染器，根宿主先挂根、子节点按 layout 顺序进父宿主", () => {
    const { harness, runtime } = harnessRuntime();
    const document = exampleDocument();

    const result = runtime.mount(document);

    expect(result.ok).toBe(true);
    expect(runtime.mounted).toBe(true);
    expect(runtime.document).toBe(document);
    expect(rendererIds(harness, "mount")).toEqual(PRE_ORDER);
    expect(rendererIds(harness, "update")).toEqual([]);
    expect(rendererIds(harness, "unmount")).toEqual([]);
    expect(harness.hostCalls[0]).toEqual({ op: "mount", id: ROOT, host: "root", index: 0 });
    expect(
      harness.hostCalls.filter((call) => call.host === "h:" + ROOT).map((call) => call.id),
    ).toEqual([NAV, MAIN]);
    expect(
      harness.hostCalls.filter((call) => call.host === "h:" + NAV).map((call) => call.id),
    ).toEqual([NAV_ITEM_A, NAV_ITEM_B]);
    expect(
      harness.hostCalls.filter((call) => call.host === "h:" + FEED).map((call) => call.id),
    ).toEqual([CARD_A, CARD_B]);
  });

  it("形状不合法的文档被拒绝：不碰渲染器与宿主", () => {
    const { harness, runtime } = harnessRuntime();
    const badRoot = exampleDocument();
    (badRoot.root as JsonRecord).kind = "column";

    const rootResult = runtime.mount(badRoot);
    expect(codesOf(rootResult)).toContain("E-TREE-ROOT");

    const badLayout = exampleDocument();
    delete nodeById(badLayout, NAV_ITEM_A).layout;

    const layoutResult = runtime.mount(badLayout);
    expect(codesOf(layoutResult)).toContain("E-TREE-PAYLOAD");

    expect(harness.rendererCalls).toEqual([]);
    expect(harness.hostCalls).toEqual([]);
    expect(runtime.mounted).toBe(false);
    expect(runtime.document).toBeNull();
    expect(runtime.diagnostics).toEqual(layoutResult.ok ? [] : layoutResult.diagnostics);
  });

  it("重复 id 在碰宿主之前被拒绝，并指出第二处 id 的路径", () => {
    const { harness, runtime } = harnessRuntime();

    const result = runtime.mount(invalidDocument("duplicate-id.json"));

    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.diagnostics).toEqual([
      {
        code: "E-TREE-DUP-ID",
        path: "/root/layout/1/id",
        message: "重复 id: bbbbbbbbbbbbbbbb",
      },
    ]);
    expect(harness.rendererCalls).toEqual([]);
    expect(harness.hostCalls).toEqual([]);
    expect(runtime.mounted).toBe(false);
  });

  it("未知 kind：拒绝并原子回滚已建好的渲染器，宿主不被触碰", () => {
    const { harness, runtime } = harnessRuntime();
    const document = exampleDocument();
    nodeById(document, TITLE).kind = "mystery";

    const result = runtime.mount(document);

    expect(codesOf(result)).toEqual(["E-TREE-KIND"]);
    expect(runtime.mounted).toBe(false);
    expect(harness.hostCalls).toEqual([]);
    expect(rendererIds(harness, "mount")).toEqual([ROOT, NAV, NAV_ITEM_A, NAV_ITEM_B, MAIN, PAGE]);
    expect(rendererIds(harness, "unmount")).toEqual(
      [ROOT, NAV, NAV_ITEM_A, NAV_ITEM_B, MAIN, PAGE].reverse(),
    );
  });

  it("渲染器不接受子节点：E-TREE-HOST 拒绝，已建渲染器回滚", () => {
    const { harness, runtime } = harnessRuntime({ noChildHostKinds: ["column"] });

    const result = runtime.mount(exampleDocument());

    expect(codesOf(result)).toEqual(["E-TREE-HOST"]);
    expect(result.ok ? [] : result.diagnostics[0]?.path).toBe("/root/layout/0/layout");
    expect(rendererIds(harness, "mount")).toEqual([ROOT, NAV]);
    expect(rendererIds(harness, "unmount")).toEqual([NAV, ROOT]);
    expect(harness.hostCalls).toEqual([]);
    expect(runtime.mounted).toBe(false);
  });

  it("渲染器抛错：整棵回滚，挂过的节点全部卸掉，根宿主保持干净", () => {
    const { harness, runtime } = harnessRuntime({ failMountOn: MEDIA });

    const result = runtime.mount(exampleDocument());

    expect(codesOf(result)).toEqual(["E-TREE-RENDER"]);
    const mounted = rendererIds(harness, "mount");
    expect(mounted).toEqual(PRE_ORDER.slice(0, 10));
    expect(rendererIds(harness, "unmount")).toEqual([...mounted].reverse());
    expect(harness.hostCalls).toEqual([]);
    expect(runtime.mounted).toBe(false);
  });

  it("根宿主 mount 抛错：整棵渲染树回滚，runtime 未挂载", () => {
    const { harness, runtime } = harnessRuntime({ failHostMountOn: ROOT });

    const result = runtime.mount(exampleDocument());

    expect(codesOf(result)).toEqual(["E-TREE-RENDER"]);
    expect(harness.hostCalls).toEqual([]);
    expect(rendererIds(harness, "mount")).toEqual(PRE_ORDER);
    expect(rendererIds(harness, "unmount")).toEqual([...PRE_ORDER].reverse());
    expect(runtime.mounted).toBe(false);
  });

  it("重复 mount 被 E-TREE-STATE 拒绝，调用不动宿主", () => {
    const { harness, runtime } = harnessRuntime();
    const document = exampleDocument();
    expect(runtime.mount(document).ok).toBe(true);
    harness.resetCalls();

    const again = runtime.mount(exampleDocument());

    expect(codesOf(again)).toEqual(["E-TREE-STATE"]);
    expect(harness.rendererCalls).toEqual([]);
    expect(harness.hostCalls).toEqual([]);
    expect(runtime.document).toBe(document);
  });
});

describe("TreeRuntime.unmount", () => {
  it("后序卸载全部渲染器，再从根宿主摘根；之后可以重新 mount", () => {
    const { harness, runtime } = harnessRuntime();
    expect(runtime.mount(exampleDocument()).ok).toBe(true);
    harness.resetCalls();

    runtime.unmount();

    expect(runtime.mounted).toBe(false);
    expect(runtime.document).toBeNull();
    expect(rendererIds(harness, "unmount")).toEqual(POST_ORDER);
    expect(harness.rendererCalls.some((call) => call.op === "mount")).toBe(false);
    expect(harness.hostCalls).toEqual([{ op: "unmount", id: ROOT, host: "root" }]);

    harness.resetCalls();
    expect(runtime.mount(exampleDocument()).ok).toBe(true);
    expect(runtime.mounted).toBe(true);
    expect(rendererIds(harness, "mount")).toEqual(PRE_ORDER);
  });

  it("未挂载时 unmount 是空操作", () => {
    const { harness, runtime } = harnessRuntime();

    runtime.unmount();

    expect(harness.rendererCalls).toEqual([]);
    expect(harness.hostCalls).toEqual([]);
    expect(runtime.mounted).toBe(false);
  });
});

describe("TreeRuntime.dispose", () => {
  it("卸载后收口：重复 dispose 幂等，之后 mount / replace 一律 E-TREE-DISPOSED 且不碰宿主", () => {
    const { harness, runtime } = harnessRuntime();
    expect(runtime.mount(exampleDocument()).ok).toBe(true);
    harness.resetCalls();

    runtime.dispose();

    expect(runtime.disposed).toBe(true);
    expect(runtime.mounted).toBe(false);
    expect(harness.hostCalls).toEqual([{ op: "unmount", id: ROOT, host: "root" }]);

    harness.resetCalls();
    runtime.dispose();
    runtime.unmount();
    const afterMount = runtime.mount(exampleDocument());
    const afterReplace = runtime.replace(exampleDocument());

    expect(codesOf(afterMount)).toEqual(["E-TREE-DISPOSED"]);
    expect(codesOf(afterReplace)).toEqual(["E-TREE-DISPOSED"]);
    expect(harness.rendererCalls).toEqual([]);
    expect(harness.hostCalls).toEqual([]);
  });
});

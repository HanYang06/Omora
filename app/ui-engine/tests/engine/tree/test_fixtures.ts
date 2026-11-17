/**
 * V1 tree runtime 测试支持：读共享 `schema/tree` 示例 / 非法用例，造只记录调用的
 * 假宿主与假渲染器。只在 `*.test.ts` 里 import，不属于运行时模块图。
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Node as TreeNode } from "../../../src/contract/tree_generated";
import { NodeRendererRegistry } from "../../../src/engine/tree/registry";
import type {
  NodeRenderer,
  NodeRendererFactory,
  TreeChildHandle,
  TreeHost,
} from "../../../src/engine/tree/types";

// src/engine/tree -> src -> ui-engine -> app -> 仓库根
const TREE_URL = new URL("../../../../../schema/tree/", import.meta.url);

/** 共享示例文档里出现的 kind；测试默认全部注册。 */
export const EXAMPLE_KINDS = [
  "app",
  "column",
  "button",
  "text",
  "search",
  "card",
  "audio",
] as const;

export const EXAMPLE_ROOT_ID = "a1b2c3d4e5f6a7b8";

export type JsonRecord = Record<string, unknown>;

export function readTreeJson(relativePath: string): JsonRecord {
  return JSON.parse(
    readFileSync(fileURLToPath(new URL(relativePath, TREE_URL)), "utf8"),
  ) as JsonRecord;
}

/** 共享示例 `schema/tree/example/tree.root.json` 的可改副本。 */
export function exampleDocument(): JsonRecord {
  return structuredClone(readTreeJson("example/tree.root.json"));
}

/** 共享非法用例 `schema/tree/invalid/<name>.json` 的可改副本。 */
export function invalidDocument(name: string): JsonRecord {
  return structuredClone(readTreeJson("invalid/" + name));
}

/** 前序遍历找节点（测试里改 fixture 用）。 */
export function nodeById(document: JsonRecord, id: string): JsonRecord {
  const found = findNode(document.root as TreeNode, id);
  if (found === undefined) {
    throw new Error("fixture 里没有节点 " + id);
  }
  return found as unknown as JsonRecord;
}

function findNode(node: TreeNode, id: string): TreeNode | undefined {
  if (node.id === id) {
    return node;
  }
  for (const child of node.layout) {
    const found = findNode(child, id);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

/** 从父节点的 layout 里摘掉一个子树（测试替换用）。 */
export function removeNode(document: JsonRecord, id: string): void {
  const layout = layoutContaining(document.root as TreeNode, id);
  if (layout === undefined) {
    throw new Error("fixture 里没有节点 " + id);
  }
  const index = layout.findIndex((child) => child.id === id);
  layout.splice(index, 1);
}

function layoutContaining(node: TreeNode, id: string): TreeNode[] | undefined {
  if (node.layout.some((child) => child.id === id)) {
    return node.layout;
  }
  for (const child of node.layout) {
    const found = layoutContaining(child, id);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

/** 往根 layout 末尾追加一个形状合法的新节点（chain 由根 chain 派生）。 */
export function appendRootChild(
  document: JsonRecord,
  id: string,
  kind: string,
  order: number,
): JsonRecord {
  const root = document.root as TreeNode;
  const node: TreeNode = {
    id,
    chain: root.chain + "." + id,
    kind,
    order,
    layout: [],
    settings: {},
    bind: {},
    on: {},
    emit: {},
  };
  root.layout.push(node);
  return node as unknown as JsonRecord;
}

export interface RendererCall {
  readonly op: "mount" | "update" | "unmount";
  readonly id: string;
  readonly kind: string;
}

export interface HostCall {
  readonly op: "mount" | "update" | "unmount";
  readonly id: string;
  readonly host: string;
  readonly index?: number;
}

export interface FakeHarnessOptions {
  /** 额外 / 替换注册的 kind；默认 EXAMPLE_KINDS。 */
  readonly kinds?: readonly string[];
  /** 这个 id 的渲染器 mount 抛错。 */
  readonly failMountOn?: string;
  /** 这个 id 的渲染器 update 抛错。 */
  readonly failUpdateOn?: string;
  /** 这个 id 的渲染器 unmount 抛错。 */
  readonly failUnmountOn?: string;
  /** 这些 kind 的渲染器返回 null child host（不接受子节点）。 */
  readonly noChildHostKinds?: readonly string[];
  /** 这个 id 的子节点被 host.mount 时宿主抛错。 */
  readonly failHostMountOn?: string;
}

export interface FakeHarness {
  readonly host: TreeHost;
  readonly renderers: NodeRendererRegistry;
  readonly rendererCalls: RendererCall[];
  readonly hostCalls: HostCall[];
  /** 清空调用记录（mount 之后用，只关注后续增量）。 */
  resetCalls(): void;
  /** 某节点收到的渲染器调用序列，如 ["update"] / ["mount", "unmount"]。 */
  rendererOps(id: string): string[];
  /** 某节点收到的宿主调用序列。 */
  hostOps(id: string): string[];
}

/** 脚手架：根宿主 + 每个示例 kind 一个只记日志的假渲染器。 */
export function fakeHarness(options: FakeHarnessOptions = {}): FakeHarness {
  const rendererCalls: RendererCall[] = [];
  const hostCalls: HostCall[] = [];
  const noChildHostKinds = new Set(options.noChildHostKinds ?? []);
  const renderers = new NodeRendererRegistry();
  for (const kind of options.kinds ?? EXAMPLE_KINDS) {
    renderers.register(
      kind,
      fakeRendererFactory(kind, rendererCalls, hostCalls, options, noChildHostKinds),
    );
  }
  return {
    host: fakeHost("root", hostCalls, options.failHostMountOn),
    renderers,
    rendererCalls,
    hostCalls,
    resetCalls(): void {
      rendererCalls.length = 0;
      hostCalls.length = 0;
    },
    rendererOps(id: string): string[] {
      return rendererCalls.filter((call) => call.id === id).map((call) => call.op);
    },
    hostOps(id: string): string[] {
      return hostCalls.filter((call) => call.id === id).map((call) => call.op);
    },
  };
}

/** 假宿主：只把 mount / update / unmount 记进调用日志；可选按 id 让 mount 抛错。 */
export function fakeHost(label: string, calls: HostCall[], failMountOn?: string): TreeHost {
  return {
    mount(child: TreeChildHandle, index: number): void {
      if (child.node.id === failMountOn) {
        throw new Error("假宿主挂载失败: " + child.node.id);
      }
      calls.push({ op: "mount", id: child.node.id, host: label, index });
    },
    update(child: TreeChildHandle, index: number): void {
      calls.push({ op: "update", id: child.node.id, host: label, index });
    },
    unmount(child: TreeChildHandle): void {
      calls.push({ op: "unmount", id: child.node.id, host: label });
    },
  };
}

function fakeRendererFactory(
  kind: string,
  rendererCalls: RendererCall[],
  hostCalls: HostCall[],
  options: FakeHarnessOptions,
  noChildHostKinds: ReadonlySet<string>,
): NodeRendererFactory {
  return (): NodeRenderer => {
    const renderer: NodeRenderer = {
      mount(current): { output: string; host: TreeHost | null } {
        if (current.id === options.failMountOn) {
          throw new Error("假渲染器挂载失败: " + current.id);
        }
        rendererCalls.push({ op: "mount", id: current.id, kind });
        return {
          output: current.id,
          host: noChildHostKinds.has(kind)
            ? null
            : fakeHost("h:" + current.id, hostCalls, options.failHostMountOn),
        };
      },
      update(current): void {
        if (current.id === options.failUpdateOn) {
          throw new Error("假渲染器更新失败: " + current.id);
        }
        rendererCalls.push({ op: "update", id: current.id, kind });
      },
      unmount(current): void {
        if (current.id === options.failUnmountOn) {
          throw new Error("假渲染器卸载失败: " + current.id);
        }
        rendererCalls.push({ op: "unmount", id: current.id, kind });
      },
    };
    return renderer;
  };
}

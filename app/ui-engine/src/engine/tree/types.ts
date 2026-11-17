/**
 * V1 tree runtime 的窄契约：宿主、渲染器、注册表与挂载期诊断码。
 *
 * 这一层不碰 DOM：runtime 只调接口，真实实现（DOM 宿主 / 渲染器、测试 fake）由外面注入。
 * 树**形状**的单一来源是 `schema/tree/tree.schema.json`（生成类型在
 * `contract/tree_generated.ts`，ajv 校验在 `contract/tree.ts`）；本模块只定义
 * “把一棵已 compose 的树挂起来”需要的最小接口。
 */

import type { Node as TreeNode } from "../../contract/tree_generated";
import type { TreeDiagnosticCode } from "../../contract/tree";

/** 渲染输出：runtime 不解释内容（DOM 实现里是元素，测试里可以是任意句柄）。 */
export type TreeOutput = unknown;

/** 挂到宿主上的子节点句柄；宿主只读 node / output，不碰 runtime 内部状态。 */
export interface TreeChildHandle {
  readonly node: TreeNode;
  readonly output: TreeOutput;
}

/**
 * 宿主：一个能安放子节点的位置。根宿主由调用方提供，其余由渲染器在 mount 时给出。
 * 三个动作都只作用于**直接子节点**，不递归；宿主只负责排布与摘除。
 */
export interface TreeHost {
  mount(child: TreeChildHandle, index: number): void;
  update(child: TreeChildHandle, index: number): void;
  unmount(child: TreeChildHandle): void;
}

/** 渲染器 mount 的产物。 */
export interface NodeRendererMount {
  output: TreeOutput;
  /** 子节点挂载点；null = 该 kind 不接受 layout children（节点有子节点即挂载失败）。 */
  host: TreeHost | null;
}

/**
 * 一个 kind 的渲染实现；runtime 为每个已挂载节点持有一份实例。
 *
 * 生命周期：mount 父先子后；unmount 子先父后。unmount 只清自己，子节点由 runtime 先卸。
 * 同一实例的 child host 在实例存活期间必须稳定（update 不能换挂载点）。
 */
export interface NodeRenderer {
  mount(node: TreeNode): NodeRendererMount;
  update(node: TreeNode, output: TreeOutput): void;
  unmount(node: TreeNode, output: TreeOutput): void;
}

/** 按节点建渲染器；registry 只按 kind 查找，未知 kind 返回 undefined。 */
export type NodeRendererFactory = (node: TreeNode) => NodeRenderer;

/** 渲染器注册表：runtime 只依赖这一个查询。 */
export interface RendererRegistry {
  get(kind: string): NodeRendererFactory | undefined;
}

/**
 * 挂载期诊断码。形状 / id / chain / mount / root 的码沿用 `contract/tree.ts`
 * （与 Python 语义层一致）；这里补 runtime 自己产生的码。
 */
export type TreeRuntimeDiagnosticCode =
  | TreeDiagnosticCode
  | "E-TREE-DUP-ID" // 同一 id 在树里出现两次
  | "E-TREE-KIND" // kind 没有注册渲染器
  | "E-TREE-HOST" // 渲染器不接受子节点，但节点有 layout
  | "E-TREE-RENDER" // 渲染器 / 宿主抛错
  | "E-TREE-STATE" // 调用时机不对（例如重复 mount）
  | "E-TREE-DISPOSED"; // runtime 已 dispose

/** 一条挂载诊断；path 是文档的 JSON Pointer（根为 ""），能带现场就带。 */
export interface TreeRuntimeDiagnostic {
  code: TreeRuntimeDiagnosticCode;
  path: string;
  message: string;
}

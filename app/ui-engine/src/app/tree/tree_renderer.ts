/**
 * V1 渲染适配器：`dendro.tree/1` 节点 → 现有组件（`Kind`）→ DOM。
 *
 * 只替换「协调层」：DOM 组件本身一行不改，Slot 那套 `DomRenderer` 也不参与。
 * V1 的运行时（TreeRuntime）负责按 id 建 / 更新 / 卸节点，这里负责每个节点的
 * 一次挂载：形状搬运 + placement + 子挂载点。
 *
 * 形状搬运：
 * - `kind` → `type`，`settings` → `props`，`on` → `events`（只收字符串 handler id）；
 * - `layout` 由运行时挂，不塞进 `children`；但部分 kind 读子节点数据（tabs / search），
 *   所以直接子节点按同规则浅搬（不递归），够读 props 就够了。
 *
 * placement：`slot.size` → 内联 width / height（数字按 px，"fill" → 100%），
 * `slot.align` → align-self。V1 没有 Slot 的 flow / gap / scroll 描述符，
 * 这些由 kind 自己（column / row / list…）表达。
 */

import type { Node as TreeNode, Placement } from "../../contract/tree_generated";
import { NodeRendererRegistry } from "../../engine/tree/registry";
import { TreeRuntime } from "../../engine/tree/runtime";
import type {
  NodeRenderer,
  NodeRendererMount,
  RendererRegistry,
  TreeHost,
  TreeOutput,
} from "../../engine/tree/types";
import { treeKinds } from "../../components/tree_kinds";
import type { Kind, KindRegistry, Node as LegacyNode, RenderContext } from "../../renderer/types";
import { DomTreeHost } from "./tree_host";

function asElement(output: TreeOutput): HTMLElement {
  if (!(output instanceof HTMLElement)) {
    throw new Error("V1 渲染输出不是 HTMLElement");
  }
  return output;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function propsOf(node: TreeNode, data: Record<string, unknown>): Record<string, unknown> {
  if (node.collection?.virtual !== true) {
    return node.settings;
  }
  const entry = data[node.collection.source];
  const items = isRecord(entry) && Array.isArray(entry.items) ? entry.items : [];
  return { ...node.settings, items };
}

function handlersOf(on: Record<string, unknown>): Record<string, string> {
  const events: Record<string, string> = {};
  for (const [name, value] of Object.entries(on)) {
    if (typeof value === "string" && value.length > 0) {
      events[name] = value;
    }
  }
  return events;
}

/** 直接子节点浅搬：kind 读子节点数据时（tabs / search）能拿到 props / events。 */
function shallowChild(node: TreeNode): LegacyNode {
  return {
    type: node.kind,
    props: node.settings,
    children: [],
    id: node.id,
    events: handlersOf(node.on),
  };
}

function toLegacyNode(node: TreeNode, data: Record<string, unknown>): LegacyNode {
  return {
    type: node.kind,
    props: propsOf(node, data),
    children: node.layout.map(shallowChild),
    id: node.id,
    events: handlersOf(node.on),
  };
}

function cssSize(value: string | number): string {
  if (typeof value === "number") {
    return String(value) + "px";
  }
  return value === "fill" ? "100%" : value;
}

function alignValue(align: NonNullable<Placement["align"]>): string {
  if (align === "start") {
    return "flex-start";
  }
  if (align === "center") {
    return "center";
  }
  return "stretch";
}

/** 把 V1 placement 落到元素上；字段消失时清掉，避免 update 后残留。 */
function applyPlacement(el: HTMLElement, slot: Placement | undefined): void {
  const width = slot?.size?.width;
  const height = slot?.size?.height;
  setStyle(el, "width", width === undefined ? undefined : cssSize(width));
  setStyle(el, "height", height === undefined ? undefined : cssSize(height));
  setStyle(el, "alignSelf", slot?.align === undefined ? undefined : alignValue(slot.align));
}

function setStyle(
  el: HTMLElement,
  name: "width" | "height" | "alignSelf",
  value: string | undefined,
): void {
  if (value === undefined) {
    el.style.removeProperty(name === "alignSelf" ? "align-self" : name);
    return;
  }
  el.style[name] = value;
}

/** kind 的子挂载点；null / 空数组 = 这个 kind 不接受子节点。 */
function childHostsOf(kind: Kind, el: HTMLElement, node: LegacyNode): HTMLElement[] {
  if (kind.childrenHosts === undefined) {
    return [el];
  }
  const hosts = kind.childrenHosts(el, node);
  if (hosts === null) {
    return [];
  }
  return hosts.filter((host): host is HTMLElement => host !== null);
}

/** 一个 V1 节点的渲染器：mount / update / unmount 都用同一个 Kind 实例。 */
export function createTreeKindRenderer(kind: Kind, context: RenderContext): NodeRenderer {
  let childHost: DomTreeHost | null = null;
  let data: Record<string, unknown> = {};
  return {
    setData(next: Record<string, unknown>): void {
      data = next;
    },
    mount(node: TreeNode): NodeRendererMount {
      const legacy = toLegacyNode(node, data);
      const el = kind.create(legacy, context);
      applyPlacement(el, node.slot);
      const hosts = childHostsOf(kind, el, legacy);
      childHost = hosts.length === 0 ? null : new DomTreeHost(hosts);
      return { output: el, host: childHost };
    },
    update(node: TreeNode, output: TreeOutput): void {
      const el = asElement(output);
      const legacy = toLegacyNode(node, data);
      kind.update?.(el, legacy, context);
      applyPlacement(el, node.slot);
      if (childHost !== null) {
        childHost.replaceHosts(childHostsOf(kind, el, legacy));
      }
    },
    unmount(_node: TreeNode, output: TreeOutput): void {
      kind.destroy?.(asElement(output));
    },
  };
}

/** V1 kind 词表 → 运行时注册表；每个节点一个渲染器实例。 */
export function createTreeRegistry(
  context: RenderContext,
  kinds: KindRegistry = treeKinds,
): RendererRegistry {
  const registry = new NodeRendererRegistry();
  for (const [name, kind] of Object.entries(kinds)) {
    registry.register(name, () => createTreeKindRenderer(kind, context));
  }
  return registry;
}

/**
 * 把一份 `dendro.tree/1` 文档挂到容器上；失败直接抛（带诊断），不留半棵树。
 * 返回 runtime，调用方负责 replace / unmount / dispose。
 */
export function mountTreeDocument(
  container: HTMLElement,
  document: unknown,
  context: RenderContext,
  kinds: KindRegistry = treeKinds,
): TreeRuntime {
  const host: TreeHost = new DomTreeHost([container]);
  const runtime = new TreeRuntime({ host, renderers: createTreeRegistry(context, kinds) });
  const mounted = runtime.mount(document);
  if (!mounted.ok) {
    runtime.dispose();
    throw new Error("V1 文档挂载失败：" + JSON.stringify(mounted.diagnostics));
  }
  return runtime;
}

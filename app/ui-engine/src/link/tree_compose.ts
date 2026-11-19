/**
 * 构建期树 V1 组合器：把 partial 挂进 base document，得到唯一 document。
 *
 * 范围（V1，仅构建期；不接 Vite / 运行时）：
 * - 输入 base（document）+ partials（partial）；partial 的 `mount.mode` 只实现 `new`，
 *   `overlay` 形状合法但未实现（E-MOUNT-UNSUPPORTED）。
 * - 先过 `contract/tree` 的 shape 校验（schema 单一来源）；shape 失败时不再跑挂载语义。
 * - 语义只做「挂载」这一层：按 `mount.parent` 的稳定 id 在**当前已组合的树**里找父节点
 *   （base 或更早挂上的 partial），把 partial.root 挂进父的 layout，按 order 升序排序。
 *   节点内部不变量（chain 由父 chain 推出、id / chain / 同级 order 唯一）由 Python 解析器
 *   守（`app/sdk/omora/sdk/tree.py`），这里不重复实现；组合器只检查跨树的身份冲突、
 *   挂载链接与落在父级上的 order 冲突。
 * - 原子：有 error 不产出 document，也不改入参（在 base 的深拷贝上挂）。
 * - 成功输出确定：同一父下 order 唯一，挂载后按 order 排序，所以 layout 顺序只由 order
 *   决定；互不依赖的 partial 换输入顺序得到同一个 document（挂到更早 partial 引入的节点时，
 *   那条依赖必须先满足）。
 *
 * 诊断 path 是「输入定位 + JSON Pointer」：base 记为 `base`，第 i 个 partial 记为
 * `partials[i]`。诊断按 (path, code, message) 升序；同一输入序列的结果完全确定。
 *
 * 诊断码（shape 诊断沿用 `contract/tree`，不另造）：
 * - E-TREE-ID / E-TREE-CHAIN / E-TREE-MOUNT / E-TREE-ROOT / E-TREE-PAYLOAD：shape 错误。
 * - E-COLLISION：挂载后树里出现重复身份 / 同父 order 冲突。partial 子树里任一 id 或 chain
 *   已在当前树中，或父节点已有同 order 的子节点，都算冲突。
 * - E-PARENT-MISSING：`mount.parent` 不在当前树里。
 * - E-TREE-CHAIN：partial.root.chain 不等于父 chain + '.' + root.id（错链接）。与 Python
 *   `_walk_node` 的语义码同名、含义一致：child chain 必须是父 chain + '.' + id。
 * - E-MOUNT-UNSUPPORTED：`mount.mode` 是 `overlay`；V1 build composer 未实现。
 */

import { validateTree } from "../contract/tree";
import type { TreeDiagnosticCode } from "../contract/tree";
import type { Document, Node, Partial } from "../contract/tree_generated";

/** 组合器自己定义的语义诊断码；shape 诊断码沿用 `contract/tree`。 */
export type TreeComposeDiagnosticCode =
  TreeDiagnosticCode | "E-COLLISION" | "E-PARENT-MISSING" | "E-MOUNT-UNSUPPORTED";

/** 一条组合诊断；path 是「输入定位 + JSON Pointer」。 */
export interface TreeComposeDiagnostic {
  code: TreeComposeDiagnosticCode;
  path: string;
  message: string;
}

/**
 * 组合结果：成功给唯一 document；失败只给诊断。
 * 失败结果里没有 document 字段——不给半成品。
 */
export type TreeComposeResult =
  { ok: true; document: Document } | { ok: false; diagnostics: TreeComposeDiagnostic[] };

/** 当前已组合树的身份索引；key 在 base 与所有已挂 partial 之间全局唯一。 */
interface TreeIndex {
  byId: Map<string, Node>;
  byChain: Map<string, Node>;
  /** 能作为 mount.parent 的 id；collection.templates 里的节点不可挂载。 */
  mountable: Set<string>;
}

function compareText(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

/** 诊断排序：按 (path, code, message)；同一组输入永远得到同一个顺序。 */
function sortDiagnostics(diagnostics: readonly TreeComposeDiagnostic[]): TreeComposeDiagnostic[] {
  return [...diagnostics].sort(
    (left, right) =>
      compareText(left.path, right.path) ||
      compareText(left.code, right.code) ||
      compareText(left.message, right.message),
  );
}

function shapeDiagnostics(
  source: string,
  value: unknown,
  shape: "document" | "partial",
): TreeComposeDiagnostic[] {
  return validateTree(value, shape).map((diagnostic) => ({
    code: diagnostic.code,
    path: source + diagnostic.path,
    message: diagnostic.message,
  }));
}

function indexNode(node: Node, index: TreeIndex, mountable: boolean): void {
  index.byId.set(node.id, node);
  index.byChain.set(node.chain, node);
  if (mountable) {
    index.mountable.add(node.id);
  }
  for (const child of node.layout) {
    indexNode(child, index, mountable);
  }
  // 模板是不挂载的子树：参与身份冲突检查，但不能当挂载目标。
  for (const template of Object.values(node.collection?.templates ?? {})) {
    indexNode(template, index, false);
  }
}

function indexDocument(document: Document): TreeIndex {
  const index: TreeIndex = { byId: new Map(), byChain: new Map(), mountable: new Set() };
  indexNode(document.root, index, true);
  return index;
}

/**
 * partial 子树里的身份冲突：任一 id 或 chain 已在当前树里就是 E-COLLISION。
 * 每个节点先查 id 再查 chain（id 撞了就不重复报 chain）。
 */
function collisionDiagnostics(root: Node, site: string, index: TreeIndex): TreeComposeDiagnostic[] {
  const diagnostics: TreeComposeDiagnostic[] = [];
  const walk = (node: Node, path: string): void => {
    if (index.byId.has(node.id)) {
      diagnostics.push({
        code: "E-COLLISION",
        path: path + "/id",
        message: `id "${node.id}" 已在当前树中`,
      });
    } else if (index.byChain.has(node.chain)) {
      diagnostics.push({
        code: "E-COLLISION",
        path: path + "/chain",
        message: `chain "${node.chain}" 已在当前树中`,
      });
    }
    node.layout.forEach((child, childIndex) => {
      walk(child, `${path}/layout[${String(childIndex)}]`);
    });
    for (const [name, template] of Object.entries(node.collection?.templates ?? {})) {
      walk(template, `${path}/collection/templates/${name}`);
    }
  };
  walk(root, site);
  return diagnostics;
}

/**
 * 挂一个 partial：找父、查链接、查冲突，全通过才挂进 document 的 layout 并排序。
 * 有 error 时只写诊断，不碰 document / index（下一次 partial 看到的是失败前的树）。
 */
function mountPartial(
  index: TreeIndex,
  partial: Partial,
  source: string,
  diagnostics: TreeComposeDiagnostic[],
): void {
  const mount = partial.mount;
  if (mount.mode !== "new") {
    diagnostics.push({
      code: "E-MOUNT-UNSUPPORTED",
      path: source + "/mount/mode",
      message: `mount.mode "${mount.mode}" 未实现：V1 build composer 只支持 "new"`,
    });
    return;
  }
  const parent = index.byId.get(mount.parent);
  if (parent === undefined || !index.mountable.has(mount.parent)) {
    diagnostics.push({
      code: "E-PARENT-MISSING",
      path: source + "/mount/parent",
      message:
        parent === undefined
          ? `mount.parent "${mount.parent}" 不在当前树中`
          : `mount.parent "${mount.parent}" 在 collection.templates 里，模板不可挂载`,
    });
    return;
  }

  const root = partial.root;
  const expectedChain = `${parent.chain}.${root.id}`;
  const errors: TreeComposeDiagnostic[] = [];
  if (root.chain !== expectedChain) {
    errors.push({
      code: "E-TREE-CHAIN",
      path: source + "/root/chain",
      message: `root.chain 必须是父 chain + '.' + id：期望 "${expectedChain}"，实际 "${root.chain}"`,
    });
  }
  errors.push(...collisionDiagnostics(root, source + "/root", index));
  const orderOwner = parent.layout.find((child) => child.order === root.order);
  if (orderOwner !== undefined) {
    errors.push({
      code: "E-COLLISION",
      path: source + "/root/order",
      message: `父节点 "${parent.id}" 已有 order ${String(root.order)} 的子节点 "${orderOwner.id}"`,
    });
  }
  if (errors.length > 0) {
    diagnostics.push(...errors);
    return;
  }

  const mounted = structuredClone(root);
  parent.layout.push(mounted);
  parent.layout.sort((left, right) => left.order - right.order);
  indexNode(mounted, index, true);
}

/**
 * 组合 base + partials；纯函数，失败不产 document、不改入参。
 * partial 按输入顺序应用，所以后挂的 partial 可以把父节点选在更早挂上的 partial 里。
 */
export function composeTree(base: unknown, partials: readonly unknown[]): TreeComposeResult {
  const shapes: TreeComposeDiagnostic[] = shapeDiagnostics("base", base, "document");
  partials.forEach((partial, index) => {
    shapes.push(...shapeDiagnostics(`partials[${String(index)}]`, partial, "partial"));
  });
  if (shapes.length > 0) {
    return { ok: false, diagnostics: sortDiagnostics(shapes) };
  }

  const document = structuredClone(base) as Document;
  const index = indexDocument(document);
  const diagnostics: TreeComposeDiagnostic[] = [];
  (partials as readonly Partial[]).forEach((partial, indexOfPartial) => {
    mountPartial(index, partial, `partials[${String(indexOfPartial)}]`, diagnostics);
  });
  if (diagnostics.length > 0) {
    return { ok: false, diagnostics: sortDiagnostics(diagnostics) };
  }
  return { ok: true, document };
}

/** 门禁失败：带整组组合诊断；构建期调用方可直接打印或让构建失败。 */
export class TreeComposeError extends Error {
  readonly diagnostics: readonly TreeComposeDiagnostic[];

  constructor(diagnostics: readonly TreeComposeDiagnostic[]) {
    super(
      "树组合失败：\n" +
        diagnostics
          .map((diagnostic) => `  ${diagnostic.code} @ ${diagnostic.path}: ${diagnostic.message}`)
          .join("\n"),
    );
    this.name = "TreeComposeError";
    this.diagnostics = diagnostics;
  }
}

/**
 * 构建期门禁入口：成功返回唯一 document，失败抛 TreeComposeError（不返回半成品）。
 * 测试可直接调用；是否接 Vite / 运行时由调用方决定，本模块不接线。
 */
export function assertTreeComposes(base: unknown, partials: readonly unknown[]): Document {
  const result = composeTree(base, partials);
  if (!result.ok) {
    throw new TreeComposeError(result.diagnostics);
  }
  return result.document;
}

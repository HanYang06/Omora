/**
 * V1 ops 应用端：把 `parseOps` 的批量落到一份 `dendro.tree/1` 文档上。
 *
 * 语义：
 * - `base` 必须等于当前文档版本，`batch.document` 必须等于 `base + 1`，否则 `E-VERSION`；
 * - ops 按声明序应用；任一失败整批不生效，原文档不变（返回诊断，不抛）；
 * - 只沿被触碰节点的祖先路径复制：未触碰的兄弟保持原引用（结构化共享）；
 * - 结构操作只作用于 layout 里的 live 节点；`collection.templates` 里的节点可
 *   `setProps`，但不能 mount / unmount / replace（模板位置来自命名表）。
 *
 * 版本与索引：本函数每次按当前文档建一次 id 索引（O(N)），应用后不维护增量索引；
 * 运行时可以逐步把它替换成跨批次的索引。DOM 只该 patch `changed` 里的子树根。
 *
 * `data` op 只写文档层：把 `data[source]` 写成 `{revision, value}` 或
 * `{revision, items}`。revision 相等是幂等 no-op，更小是过期（忽略并记
 * `E-DATA-STALE`），更大才应用。它不改结构、也不进 `changed`；collection 实例化 /
 * bind / `changes` 增量是下一步，遇到 `changes` 整批 `E-PAYLOAD`，不让“只应用一半”
 * 的更新溜过去。
 */

import type { Document, Node } from "../../contract/tree_generated";
import { parseOps, type DataOp, type OpsBatch, type OpsDiagnostic, type WireOp } from "./ops";

export type ApplyDiagnosticCode =
  | "E-PAYLOAD"
  | "E-VERSION"
  | "E-TARGET-MISSING"
  | "E-TREE-CHAIN"
  | "E-TREE-DUP-ID"
  | "E-TREE-ORDER"
  | "E-DATA-STALE";

/** 一条应用诊断；path 是 ops payload 的 JSON Pointer。 */
export interface ApplyDiagnostic {
  code: ApplyDiagnosticCode;
  path: string;
  message: string;
}

export type ApplyOpsResult =
  | {
      ok: true;
      document: Document;
      changed: string[];
      byId: ReadonlyMap<string, Node>;
      /** 成功也可能带非致命诊断（例如过期 data revision 被忽略）。 */
      diagnostics: ApplyDiagnostic[];
    }
  | { ok: false; diagnostics: ApplyDiagnostic[] };

/** 成功结果：新文档 + 被触碰的子树根 + id → 新节点。 */
export type AppliedDocument = Extract<ApplyOpsResult, { ok: true }>;

interface Location {
  node: Node;
  parent: Node | null;
  index: number;
  /** layout 可达（live）还是 collection.templates 里的模板子树。 */
  live: boolean;
}

type DocumentIndex = Map<string, Location>;

function indexDocument(root: Node): DocumentIndex {
  const byId: DocumentIndex = new Map();
  const visit = (node: Node, parent: Node | null, index: number, live: boolean): void => {
    byId.set(node.id, { node, parent, index, live });
    node.layout.forEach((child, childIndex) => {
      visit(child, node, childIndex, live);
    });
    for (const template of Object.values(node.collection?.templates ?? {})) {
      visit(template, null, -1, false);
    }
  };
  visit(root, null, -1, true);
  return byId;
}

function hasTemplates(node: Node): boolean {
  if (node.collection !== undefined) {
    return true;
  }
  return node.layout.some(hasTemplates);
}

/**
 * 目标 + 全部祖先；树里有模板时返回 undefined（退回整棵深拷）。
 * 没有任何结构 op（例如只有 data）时返回空集：根引用原样保留，data 不改结构。
 */
function cloneTargets(
  root: Node,
  ops: readonly WireOp[],
  index: DocumentIndex,
): Set<string> | undefined {
  const ids = new Set<string>();
  for (const op of ops) {
    const target = targetOf(op);
    if (target === undefined) {
      continue;
    }
    let current = index.get(target);
    while (current !== undefined) {
      ids.add(current.node.id);
      current = current.parent === null ? undefined : index.get(current.parent.id);
    }
  }
  if (ids.size === 0) {
    return ids;
  }
  if (hasTemplates(root)) {
    return undefined;
  }
  return ids;
}

function targetOf(op: WireOp): string | undefined {
  switch (op.op) {
    case "setProps":
    case "unmount":
    case "replace":
      return op.id;
    case "mount":
      return op.parent;
    case "data":
      return undefined;
  }
}

function cloneAlong(node: Node, targets: ReadonlySet<string>): Node {
  if (!targets.has(node.id)) {
    return node;
  }
  return { ...node, layout: node.layout.map((child) => cloneAlong(child, targets)) };
}

function failure(
  code: ApplyDiagnosticCode,
  path: string,
  message: string,
): { ok: false; diagnostics: ApplyDiagnostic[] } {
  return { ok: false, diagnostics: [{ code, path, message }] };
}

function collectIds(node: Node, out: Set<string>): void {
  out.add(node.id);
  for (const child of node.layout) {
    collectIds(child, out);
  }
  for (const template of Object.values(node.collection?.templates ?? {})) {
    collectIds(template, out);
  }
}

/** 子树 chain / order / id 的自洽检查；父链由调用方给出。 */
function subtreeProblem(
  node: Node,
  parentChain: string | null,
  knownIds: ReadonlySet<string>,
): string | null {
  const expected = parentChain === null ? node.id : parentChain + "." + node.id;
  if (node.chain !== expected) {
    return `chain 必须是 "${expected}"，实际 "${node.chain}"`;
  }
  const orders = node.layout.map((child) => child.order);
  if (new Set(orders).size !== orders.length) {
    return `同级 order 必须唯一（节点 ${node.id}）`;
  }
  const sorted = [...orders].sort((left, right) => left - right);
  if (orders.some((order, index) => order !== sorted[index])) {
    return `layout 必须按 order 升序（节点 ${node.id}）`;
  }
  const ids = new Set<string>();
  collectIds(node, ids);
  if (ids.size !== countNodes(node)) {
    return `子树里有重复 id（节点 ${node.id}）`;
  }
  for (const id of ids) {
    if (knownIds.has(id)) {
      return `id 已存在: ${id}`;
    }
  }
  for (const child of node.layout) {
    const problem = subtreeProblem(child, node.chain, knownIds);
    if (problem !== null) {
      return problem;
    }
  }
  for (const template of Object.values(node.collection?.templates ?? {})) {
    const problem = subtreeProblem(template, node.chain, knownIds);
    if (problem !== null) {
      return problem;
    }
  }
  return null;
}

function countNodes(node: Node): number {
  let total = 1;
  for (const child of node.layout) {
    total += countNodes(child);
  }
  for (const template of Object.values(node.collection?.templates ?? {})) {
    total += countNodes(template);
  }
  return total;
}

function insertSorted(parent: Node, node: Node): void {
  parent.layout = [...parent.layout, node].sort((left, right) => left.order - right.order);
}

function precheckTargets(batch: OpsBatch, index: DocumentIndex): ApplyDiagnostic[] {
  const diagnostics: ApplyDiagnostic[] = [];
  batch.ops.forEach((op, position) => {
    const path = "/ops/" + String(position);
    const target = targetOf(op);
    if (target === undefined) {
      return;
    }
    const location = index.get(target);
    if (location === undefined) {
      diagnostics.push({
        code: "E-TARGET-MISSING",
        path: path + (op.op === "mount" ? "/parent" : "/id"),
        message: "目标不存在: " + target,
      });
      return;
    }
    if (op.op === "mount" && !location.live) {
      diagnostics.push({
        code: "E-PAYLOAD",
        path: path + "/parent",
        message: "模板节点不能挂子节点: " + target,
      });
      return;
    }
    if ((op.op === "unmount" || op.op === "replace") && !location.live) {
      diagnostics.push({
        code: "E-PAYLOAD",
        path: path + "/id",
        message: "模板节点不能做结构操作: " + target,
      });
      return;
    }
    if ((op.op === "unmount" || op.op === "replace") && location.parent === null) {
      diagnostics.push({
        code: "E-PAYLOAD",
        path: path + "/id",
        message: "根节点不能做结构操作: " + target,
      });
    }
  });
  return diagnostics;
}

/** 文档里某 source 的当前 revision；没有条目 / 形状不对时按“还没有版本”处理。 */
function currentRevision(value: unknown): number | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const revision = (value as Record<string, unknown>).revision;
  if (typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 0) {
    return null;
  }
  return revision;
}

/** data 负载必须可深拷：文档不能持有调用方之后还会改的引用。 */
class PayloadFailure extends Error {
  readonly path: string;

  constructor(path: string, message: string) {
    super(message);
    this.name = "PayloadFailure";
    this.path = path;
  }
}

function clonePayload<T>(value: T, path: string): T {
  try {
    return structuredClone(value);
  } catch {
    throw new PayloadFailure(path, "data 负载必须是可深拷的 JSON 数据");
  }
}

/** 批次里正在组装的文档数据；只在真正应用时浅拷，未改动保持原引用。 */
interface WorkingData {
  data: Record<string, unknown>;
  touched: boolean;
}

/**
 * 应用一条 data op：revision 相等 no-op、更小忽略（返回过期诊断）、更大才写。
 * 只改文档数据，不碰结构；写进去的是深拷后的值 / 条目。
 */
function applyDataOp(op: DataOp, path: string, working: WorkingData): ApplyDiagnostic | null {
  const current = currentRevision(working.data[op.source]);
  if (current !== null) {
    if (op.revision < current) {
      return {
        code: "E-DATA-STALE",
        path,
        message:
          'source "' +
          op.source +
          '" 的 revision ' +
          String(op.revision) +
          " 落后于当前 " +
          String(current) +
          "，已忽略",
      };
    }
    if (op.revision === current) {
      return null;
    }
  }
  const entry =
    op.items === undefined
      ? { revision: op.revision, value: clonePayload(op.value, path + "/value") }
      : { revision: op.revision, items: clonePayload(op.items, path + "/items") };
  if (!working.touched) {
    working.data = { ...working.data };
    working.touched = true;
  }
  working.data[op.source] = entry;
  return null;
}

function applySetProps(op: Extract<WireOp, { op: "setProps" }>, index: DocumentIndex): string {
  const target = index.get(op.id);
  if (target === undefined) {
    throw new Error("setProps 目标在预检后消失");
  }
  target.node.settings = { ...target.node.settings, ...op.props };
  return op.id;
}

function applyMount(op: Extract<WireOp, { op: "mount" }>, index: DocumentIndex): string {
  const parent = index.get(op.parent);
  if (parent === undefined || !parent.live) {
    throw new Error("mount 目标在预检后消失或不可挂载");
  }
  const node = structuredClone(op.node);
  const problem = subtreeProblem(node, parent.node.chain, new Set(index.keys()));
  if (problem !== null) {
    throw new Error(problem);
  }
  if (parent.node.layout.some((child) => child.order === node.order)) {
    throw new Error(`父节点 "${parent.node.id}" 已有 order ${String(node.order)} 的子节点`);
  }
  insertSorted(parent.node, node);
  for (const [id, location] of indexDocument(node)) {
    index.set(id, id === node.id ? { ...location, parent: parent.node } : location);
  }
  return node.id;
}

function applyUnmount(op: Extract<WireOp, { op: "unmount" }>, index: DocumentIndex): string {
  const target = index.get(op.id);
  if (target === undefined || target.parent === null) {
    throw new Error("根节点不能卸载");
  }
  target.parent.layout = target.parent.layout.filter((child) => child.id !== target.node.id);
  const removed = new Set<string>();
  collectIds(target.node, removed);
  for (const id of removed) {
    index.delete(id);
  }
  return target.node.id;
}

function applyReplace(op: Extract<WireOp, { op: "replace" }>, index: DocumentIndex): string {
  const target = index.get(op.id);
  if (target === undefined || target.parent === null) {
    throw new Error("根节点不能替换");
  }
  if (op.node.order !== target.node.order) {
    throw new Error("replace 不能改 order；换位置请用 mount / unmount");
  }
  const node = structuredClone(op.node);
  const removed = new Set<string>();
  collectIds(target.node, removed);
  const known = new Set<string>();
  for (const id of index.keys()) {
    if (!removed.has(id)) {
      known.add(id);
    }
  }
  const problem = subtreeProblem(node, target.parent.chain, known);
  if (problem !== null) {
    throw new Error(problem);
  }
  target.parent.layout = target.parent.layout.map((child) =>
    child.id === target.node.id ? node : child,
  );
  for (const id of removed) {
    index.delete(id);
  }
  for (const [id, location] of indexDocument(node)) {
    index.set(id, id === node.id ? { ...location, parent: target.parent } : location);
  }
  return node.id;
}

/**
 * 应用一批 ops；成功返回新文档（原文档不变）、被触碰的子树根 id 与非致命诊断。
 * 失败返回诊断，整批不生效。
 */
export function applyOps(document: Document, value: unknown): ApplyOpsResult {
  const parsed = parseOps(value);
  if (!parsed.ok) {
    return {
      ok: false,
      diagnostics: parsed.diagnostics.map((diagnostic: OpsDiagnostic) => ({
        code: diagnostic.code,
        path: diagnostic.path,
        message: diagnostic.message,
      })),
    };
  }
  return applyBatch(document, parsed.batch);
}

/** 已解析批量 → 新文档；版本、原子、路径复制都在这里。 */
export function applyBatch(document: Document, batch: OpsBatch): ApplyOpsResult {
  if (batch.base !== document.version) {
    return failure(
      "E-VERSION",
      "/base",
      "base " + String(batch.base) + " 与当前版本 " + String(document.version) + " 不一致",
    );
  }
  const index = indexDocument(document.root);
  const targetProblems = precheckTargets(batch, index);
  if (targetProblems.length > 0) {
    return { ok: false, diagnostics: targetProblems };
  }
  const targets = cloneTargets(document.root, batch.ops, index);
  const workingRoot =
    targets === undefined ? structuredClone(document.root) : cloneAlong(document.root, targets);
  const workingIndex = indexDocument(workingRoot);
  const workingData: WorkingData = { data: document.data, touched: false };
  const changed: string[] = [];
  const diagnostics: ApplyDiagnostic[] = [];
  let current = 0;
  try {
    batch.ops.forEach((op, position) => {
      current = position;
      const path = "/ops/" + String(position);
      switch (op.op) {
        case "setProps":
          changed.push(applySetProps(op, workingIndex));
          break;
        case "mount":
          changed.push(applyMount(op, workingIndex));
          break;
        case "unmount":
          changed.push(applyUnmount(op, workingIndex));
          break;
        case "replace":
          changed.push(applyReplace(op, workingIndex));
          break;
        case "data": {
          if (op.changes !== undefined) {
            throw new PayloadFailure(path + "/changes", "changes 还没接；先发全量 value / items");
          }
          const stale = applyDataOp(op, path, workingData);
          if (stale !== null) {
            diagnostics.push(stale);
          }
          break;
        }
      }
    });
  } catch (error) {
    if (error instanceof PayloadFailure) {
      return failure("E-PAYLOAD", error.path, error.message);
    }
    return failure(
      "E-PAYLOAD",
      "/ops/" + String(current),
      error instanceof Error ? error.message : "ops 应用失败",
    );
  }
  const byId = new Map<string, Node>();
  for (const location of workingIndex.values()) {
    byId.set(location.node.id, location.node);
  }
  return {
    ok: true,
    document: {
      ...document,
      version: batch.document,
      root: workingRoot,
      data: workingData.data,
    },
    changed: [...new Set(changed)],
    byId,
    diagnostics,
  };
}

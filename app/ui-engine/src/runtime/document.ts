/**
 * Dendrolink 文档运行时（S3-a）：文档状态与三张索引。
 *
 * 这一层只做两件事：
 * 1. `createState`：把一棵根树校验成 `DocumentState`（根树 + 文档版本）；
 * 2. `DocumentIndex`：从根树重建「可寻址节点」索引，供更新、事件、数据绑定按 id 定位。
 *
 * 索引不是另一份真值：它只缓存从根树推导出来的映射，任何时候都能从根树独立重建。
 * 更新（ops.ts）产出新根树后，调用方用 `DocumentIndex.build(newRoot)` 重建即可，
 * 所以「更新后索引与树一致」是构造出来的性质，不是靠增量维护碰巧对齐。
 *
 * 全寻址：索引覆盖 children 可达的全部节点，也覆盖每个 `collection.templates`
 * 里的模板子树。模板不挂载到 live 树上，但运行时内部必须能按 id 定位它们。
 *
 * 模板节点的位置规则（与 ops 的结构操作配套）：
 * - `get` / `childrenOf` / `slotsFor` 对模板内节点同样有效；
 * - `parentOf(模板根)` = `{ parentId: 所属 collection slot 的 id, order: -1 }`；
 *   `order = -1` 表示它不是父节点 children 里的一项，而是 templates 表里的具名模板；
 * - `parentOf(模板内部子节点)` = 它在模板 children 里的真实序号；
 * - `childrenOf(集合 slot)` 不包含模板根：模板不挂载，children 只表示 live 子节点。
 *   因此模板根有 parentId，但父的 childrenOf 里看不到它——位置来自命名表，不来自顺序。
 */

import {
  DOCUMENT_SCHEMA,
  DocumentError,
  parseDocument,
  type SlotDocument,
  type SlotNode,
} from "../contract/document";
import type { Diagnostic, DiagnosticCode } from "../contract/diagnostics";
import { makeDiagnostic } from "../contract/diagnostics";

/** 运行时持有的文档：唯一权威根树 + 单调递增的文档版本。 */
export interface DocumentState {
  root: SlotNode;
  version: number;
}

/**
 * 反查位置的结果。
 * `order` 是节点在父 children 里的序号；模板根用 `-1`（见文件头的位置规则）。
 */
export interface ParentRef {
  parentId: string;
  order: number;
}

export type CreateStateResult =
  { ok: true; state: DocumentState } | { ok: false; diagnostics: Diagnostic[] };

/** 把 `contract/document.ts` 的 DocumentError 归一成运行时诊断（createState / 节点解析共用）。 */
export function documentErrorDiagnostic(
  error: DocumentError,
  prefix: string,
  subject = "根树",
): Diagnostic {
  if (error.code === "bad_version") {
    return makeDiagnostic("E-VERSION", "文档版本不合法：" + error.message, {
      path: "$.version",
    });
  }
  const code: DiagnosticCode = error.code === "duplicate_id" ? "E-ID-DUPLICATE" : "E-PAYLOAD";
  const suffix = error.path.startsWith("$.document")
    ? error.path.slice("$.document".length)
    : error.path;
  return makeDiagnostic(code, subject + "形状不合法：" + error.message, { path: prefix + suffix });
}

/**
 * 校验并接管一棵根树。
 *
 * 失败返回诊断、不抛；成功返回的状态持有根树的一份深拷贝，调用方之后改写入参
 * 不会影响文档。文档版本默认 1。
 */
export function createState(root: unknown, version = 1): CreateStateResult {
  let document: SlotDocument;
  try {
    document = parseDocument({
      schema: DOCUMENT_SCHEMA,
      document: root,
      pages: [],
      active: "",
      data: {},
      version,
    });
  } catch (error) {
    if (!(error instanceof DocumentError)) {
      throw error;
    }
    return { ok: false, diagnostics: [documentErrorDiagnostic(error, "$.root")] };
  }
  let owned: SlotNode;
  try {
    owned = structuredClone(document.document);
  } catch {
    return {
      ok: false,
      diagnostics: [
        makeDiagnostic("E-PAYLOAD", "根树必须只含可深拷的值（JSON 数据）", { path: "$.root" }),
      ],
    };
  }
  return { ok: true, state: { root: owned, version: document.version } };
}

interface IndexTables {
  byId: Map<string, SlotNode>;
  parents: Map<string, ParentRef>;
  ids: string[];
  sources: Map<string, string[]>;
}

/** 同一条 source 被同一个 slot 声明多次时只记一次（in 与 collection 都算消费）。 */
function addSource(sources: Map<string, string[]>, source: string, id: string): void {
  const ids = sources.get(source) ?? [];
  if (ids[ids.length - 1] !== id) {
    ids.push(id);
  }
  sources.set(source, ids);
}

/**
 * 深度优先收集节点：先自己，再 children，最后 collection.templates。
 * 顺序固定，`ids()` / `slotsFor()` 的返回顺序因此与到达顺序无关。
 */
function collectIndex(node: SlotNode, parent: ParentRef | undefined, out: IndexTables): void {
  out.byId.set(node.id, node);
  out.ids.push(node.id);
  if (parent !== undefined) {
    out.parents.set(node.id, parent);
  }
  for (const input of node.in ?? []) {
    addSource(out.sources, input.source, node.id);
  }
  if (node.collection !== undefined) {
    addSource(out.sources, node.collection.source, node.id);
  }
  node.children.forEach((child, order) => {
    collectIndex(child, { parentId: node.id, order }, out);
  });
  if (node.collection !== undefined) {
    for (const template of Object.values(node.collection.templates)) {
      collectIndex(template, { parentId: node.id, order: -1 }, out);
    }
  }
}

/**
 * 从根树重建的寻址索引（纯推导，可随时丢弃重来）。
 *
 * 三张索引：id → Slot、id → (parent, order)、source → [slot id]。
 * 索引里保存的是树里的节点引用；根树换了以后请重新 `build`。
 */
export class DocumentIndex {
  readonly size: number;
  private readonly byId: Map<string, SlotNode>;
  private readonly parents: Map<string, ParentRef>;
  private readonly sources: Map<string, string[]>;
  private readonly order: string[];

  private constructor(
    byId: Map<string, SlotNode>,
    parents: Map<string, ParentRef>,
    sources: Map<string, string[]>,
    order: string[],
  ) {
    this.byId = byId;
    this.parents = parents;
    this.sources = sources;
    this.order = order;
    this.size = order.length;
  }

  /** 从根树独立重建索引。 */
  static build(root: SlotNode): DocumentIndex {
    const tables: IndexTables = {
      byId: new Map(),
      parents: new Map(),
      ids: [],
      sources: new Map(),
    };
    collectIndex(root, undefined, tables);
    return new DocumentIndex(tables.byId, tables.parents, tables.sources, tables.ids);
  }

  /** id → 节点；未知 id 返回 undefined。 */
  get(id: string): SlotNode | undefined {
    return this.byId.get(id);
  }

  /** 反查父与序号；根返回 undefined，模板根见文件头规则。 */
  parentOf(id: string): ParentRef | undefined {
    const parent = this.parents.get(id);
    return parent === undefined ? undefined : { ...parent };
  }

  /** 直接子节点（不含模板根）；未知 id 返回空数组。 */
  childrenOf(id: string): SlotNode[] {
    return [...(this.byId.get(id)?.children ?? [])];
  }

  /**
   * 消费某条数据的 slot id，按索引顺序；`in[].source` 与 `collection.source`
   * 都算消费。同一个 slot 声明多次只出现一次。
   */
  slotsFor(source: string): string[] {
    return [...(this.sources.get(source) ?? [])];
  }

  /** 全部可寻址 id（含模板子树），按固定深度优先顺序。 */
  ids(): string[] {
    return [...this.order];
  }
}

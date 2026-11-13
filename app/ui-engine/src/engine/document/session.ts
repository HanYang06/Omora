/**
 * Dendrolink 会话（S3-c）：全量文档 → SessionState，route op 与全量替换。
 *
 * 会话 = 文档运行时（根树 + 文档版本）+ 三样会话侧状态：`pages`（页面侧表）、
 * `active`（当前活动页 id）、`data`（数据文档投影）。树上只物化当前活动页的子树；
 * 换页时按 id 协调两棵子树在渲染层完成（structure.md §5），本层只把 `active` 切过去。
 *
 * 两个入口：
 * - `applySessionOps`：应用一批线上 ops，route 与树 op 可以混在同一批里，原子生效。
 *   顺序固定为：形状解析 → 版本校验（base == 当前文档版本、document == base + 1）→
 *   校验**全部** route 的目标页都在 `pages` 里 → 把去掉 route 的树 op 交给
 *   DocumentState 层的 `applyOps` → 设置 active（多条 route 按声明顺序，最后一条生效）。
 *   版本只涨一次；`changed` 只来自树 op（route 不改根树，active 的最终值在返回的
 *   session 里）。任何一步失败整批不生效，调用方手里的 session 原样不动。
 * - `applyFull`：用整份 Slot 文档做全量替换（版本对不上时的兜底）。比当前版本旧的
 *   全量直接拒绝（E-VERSION）；否则 root / pages / active / data / version 全换。
 *
 * route 为什么不在 ops 层执行：route 不碰根树，只改会话侧表与 active；而 ops 层的
 * 入参是 DocumentState（没有 pages / active）。所以 `parseOps` 认 route（线上合法性），
 * `applyOps` 遇到 route 返回 E-PAYLOAD，执行权留给这一层，避免同一批在两处各做一半。
 *
 * 原子性与入参：全是纯函数；失败只回诊断，成功也不改写入参。`createSession` /
 * `applyFull` 对 root / pages / data 深拷，会话不持有线上 payload 的引用；
 * `applySessionOps` 的 pages / data 未变时直接复用引用（结构共享）。
 */

import {
  DocumentError,
  parseDocument,
  type SlotDocument,
  type PageEntry,
} from "../../contract/document";
import type { Diagnostic, DiagnosticCode } from "../../contract/diagnostics";
import type { DocumentState } from "./document";
import { makeDiagnostic } from "../../contract/diagnostics";
import { applyOps, parseOps, type OpGuard, type OpsBatch, type WireOp } from "./ops";

/** 会话状态：文档运行时 + 页面侧表 + 活动页 + 数据文档。 */
export interface SessionState {
  /** 当前文档：权威根树 + 文档版本。 */
  document: DocumentState;
  /** 页面侧表（id / label / route / owner），供导航与路由使用。 */
  pages: PageEntry[];
  /** 当前活动页 id；没有页面时是空串。 */
  active: string;
  /** 数据文档投影：source → 该 source 的状态。 */
  data: Record<string, unknown>;
}

export type CreateSessionResult =
  { ok: true; session: SessionState } | { ok: false; diagnostics: Diagnostic[] };

export type SessionOpsResult =
  { ok: true; session: SessionState; changed: string[] } | { ok: false; diagnostics: Diagnostic[] };

export type ApplyFullResult =
  { ok: true; session: SessionState } | { ok: false; diagnostics: Diagnostic[] };

type ParsedDocument =
  { ok: true; document: SlotDocument } | { ok: false; diagnostics: Diagnostic[] };

/** 把整份文档的 DocumentError 归一成诊断：版本 → E-VERSION，重复 id → E-ID-DUPLICATE，其余 E-PAYLOAD。 */
function documentFailure(error: DocumentError): Diagnostic {
  let code: DiagnosticCode = "E-PAYLOAD";
  if (error.code === "bad_version") {
    code = "E-VERSION";
  } else if (error.code === "duplicate_id" || error.code === "duplicate_page") {
    code = "E-ID-DUPLICATE";
  }
  return makeDiagnostic(code, "文档形状不合法：" + error.message, { path: error.path });
}

function parseFullDocument(value: unknown): ParsedDocument {
  try {
    return { ok: true, document: parseDocument(value) };
  } catch (error) {
    if (!(error instanceof DocumentError)) {
      throw error;
    }
    return { ok: false, diagnostics: [documentFailure(error)] };
  }
}

/** 从已校验的整份文档建立会话：root / pages / data 深拷，避免会话与线上 payload 共享可变对象。 */
function sessionFrom(document: SlotDocument): CreateSessionResult {
  try {
    return {
      ok: true,
      session: {
        document: { root: structuredClone(document.document), version: document.version },
        pages: structuredClone(document.pages),
        active: document.active,
        data: structuredClone(document.data),
      },
    };
  } catch {
    return {
      ok: false,
      diagnostics: [
        makeDiagnostic("E-PAYLOAD", "文档必须只含可深拷的值（JSON 数据）", { path: "$" }),
      ],
    };
  }
}

function versionFailure(message: string, path: string): { ok: false; diagnostics: Diagnostic[] } {
  return { ok: false, diagnostics: [makeDiagnostic("E-VERSION", message, { path })] };
}

/** 一批里可能有多条 route；按声明顺序最后一条生效。 */
function lastRoutedPage(ops: WireOp[]): string | undefined {
  let page: string | undefined;
  for (const op of ops) {
    if (op.op === "route") {
      page = op.page;
    }
  }
  return page;
}

/**
 * 校验整份 Slot 文档并建立会话。
 *
 * 不合法返回诊断、不抛；成功时 version / pages / active 照文档保留，root / data 深拷。
 */
export function createSession(value: unknown): CreateSessionResult {
  const parsed = parseFullDocument(value);
  return parsed.ok ? sessionFrom(parsed.document) : parsed;
}

/**
 * 把树 op 诊断里的批次下标映射回原始批量。
 *
 * `applyOps` 看到的是去掉 route 的批次，它给的 `$.ops[k]` 是过滤后的下标；
 * 回给调用方的诊断必须指向调用方发来的批量，否则 route 夹在中间时定位会错位。
 */
function remapDiagnostics(diagnostics: Diagnostic[], treePositions: number[]): Diagnostic[] {
  return diagnostics.map((diagnostic) => {
    if (diagnostic.path === undefined) {
      return diagnostic;
    }
    const match = /^\$\.ops\[(\d+)\](.*)$/.exec(diagnostic.path);
    if (match === null) {
      return diagnostic;
    }
    const filtered = Number(match[1] ?? "");
    const original = treePositions[filtered];
    if (original === undefined) {
      return diagnostic;
    }
    return { ...diagnostic, path: "$.ops[" + String(original) + "]" + (match[2] ?? "") };
  });
}

/** `applySessionOps` 的选项：guard 原样透传给 applyOps；route 切页不查权限。 */
export interface SessionApplyOptions {
  guard?: OpGuard;
}

/**
 * 原子应用一批线上 ops（route 可与树 op 混批）。
 *
 * - 目标页不存在 → E-TARGET-MISSING（在树 op 之前拦下，整批不生效）；
 * - 版本语义与 ops 层一致：base == 当前文档版本且 document == base + 1，否则 E-VERSION；
 * - 树 op 复用 `applyOps`，它失败时诊断原样回传（path 的批次下标映射回原始批量）；
 *   `options.guard` 也一并透传——route 不查权限，只有树 op 走 guard；
 * - route 只把 active 切到目标页（多条按声明顺序，最后一条生效），不进 changed。
 */
export function applySessionOps(
  session: SessionState,
  batch: unknown,
  options: SessionApplyOptions = {},
): SessionOpsResult {
  const parsed = parseOps(batch);
  if (!parsed.ok) {
    return parsed;
  }
  const ops = parsed.batch;
  if (ops.base !== session.document.version) {
    return versionFailure(
      "base " +
        String(ops.base) +
        " 与当前文档版本 " +
        String(session.document.version) +
        " 不一致",
      "$.base",
    );
  }
  if (ops.document !== ops.base + 1) {
    return versionFailure(
      "document 必须是 base + 1（" + String(ops.base + 1) + "），实际是 " + String(ops.document),
      "$.document",
    );
  }
  // 先校验全部 route 目标页：任何一条不存在都整批不生效，树 op 也不会执行。
  for (const [position, op] of ops.ops.entries()) {
    if (op.op !== "route") {
      continue;
    }
    if (!session.pages.some((page) => page.id === op.page)) {
      return {
        ok: false,
        diagnostics: [
          makeDiagnostic("E-TARGET-MISSING", "route 目标页不存在: " + op.page, {
            path: "$.ops[" + String(position) + "].page",
          }),
        ],
      };
    }
  }
  const treePositions: number[] = [];
  const treeOps = ops.ops.filter((op, position) => {
    if (op.op === "route") {
      return false;
    }
    treePositions.push(position);
    return true;
  });
  const treeBatch: OpsBatch = {
    kind: "ops",
    document: ops.document,
    base: ops.base,
    seq: ops.seq,
    ops: treeOps,
  };
  const applied = applyOps(session.document, treeBatch, options);
  if (!applied.ok) {
    return { ok: false, diagnostics: remapDiagnostics(applied.diagnostics, treePositions) };
  }
  return {
    ok: true,
    session: {
      document: applied.state,
      pages: session.pages,
      active: lastRoutedPage(ops.ops) ?? session.active,
      data: session.data,
    },
    changed: applied.changed,
  };
}

/**
 * 全量替换：整份 Slot 文档接管会话状态。
 *
 * - 文档不合法 → 形状诊断（E-PAYLOAD / E-VERSION / E-ID-DUPLICATE）；
 * - `current` 存在且全量版本更旧 → E-VERSION（旧全量不回退，防止乱序到达把新状态盖掉）；
 * - 版本相同或更新都接受（幂等重放同一份全量等价于重建）；
 * - 成功时 root / pages / active / data / version 全换，data 不合并。
 */
export function applyFull(current: SessionState | null, value: unknown): ApplyFullResult {
  const parsed = parseFullDocument(value);
  if (!parsed.ok) {
    return parsed;
  }
  const version = parsed.document.version;
  if (current !== null && version < current.document.version) {
    return versionFailure(
      "全量文档版本 " + String(version) + " 低于当前版本 " + String(current.document.version),
      "$.version",
    );
  }
  return sessionFrom(parsed.document);
}

/**
 * Dendrolink 局部树更新（ops）：线上形状校验 + 原子应用。
 *
 * payload：`{kind:"ops", document, base, seq, ops:[...]}`
 * - `parseOps` 只做形状校验（字段类型 / 取值域 / 每种 op 形状与 Slot 合法性），
 *   失败给 E-PAYLOAD（节点内部重复 id 给 E-ID-DUPLICATE），不抛。
 * - `applyOps` 做版本语义与结构语义：base == state.version 且 document == base + 1，
 *   否则 E-VERSION。ops 按声明顺序在根树深拷上应用；任意一个失败整批不生效，
 *   原 state 不变。成功返回 `{root, version: document}` 与 `changed`。
 *
 * op 语义：
 * - update：id + props 浅合并（保留未提到的键，嵌套对象整体替换）；目标不存在
 *   E-TARGET-MISSING。只改内容不改位置，因此也允许指向 collection.templates 里的节点。
 * - mount：slot + at? + node；插入 slot.children，at 缺省追加到尾部，越界夹到 0..len；
 *   新子树任意 id 与现存文档冲突 → E-ID-DUPLICATE；插入后父槽 capacity 为 none/one
 *   被违反，或新子树根自身 capacity 与 children 数不符 → E-SLOT-CAPACITY。
 * - move：id + slot + at；先删后插，at 夹到删除后的 0..len；同父同位置允许（no-op）；
 *   id 或 slot 不存在 → E-TARGET-MISSING；移进自己的子树 → E-CYCLE；插入后目标槽
 *   capacity 违反 → E-SLOT-CAPACITY。
 * - unmount：id；删除整棵子树；根不能卸载（E-PAYLOAD）；目标不存在 E-TARGET-MISSING。
 * - replace：id + node；位置（以及根身份）不变；新子树 id 与「移除旧子树后剩余的文档」
 *   冲突 → E-ID-DUPLICATE（因此可以原 id 原位替换，身份保持）；新子树根自身 capacity
 *   与其 children 不符 → E-SLOT-CAPACITY。
 * - route：page + params?；只是「切到某一页」的意图，不碰根树。route 的执行在会话层
 *   （session.ts 的 applySessionOps）；DocumentState 层的 applyOps 遇到 route 一律返回
 *   E-PAYLOAD 并提示调用方走会话层，保证同一份批量不会在两层各执行一半。
 *
 * 权限（S4）：`applyOps` 接受 `options.requester`，缺省 = 系统来源（全放行，行为与
 * 接入权限层之前完全一致）。每条树 op 在应用前按 `permissions.ts` 的 op 语义检查
 * 目标 Slot 的能力；任一拒绝 → 整批不生效、只回一条 E-PERMISSION，原 state 不变。
 * 目标不存在的结构错误仍由 ops_apply 按既有语义先报，权限检查不抢诊断码。
 *
 * 模板与结构操作：collection.templates 里的节点可寻址、可 update 内容，但位置由
 * templates 命名表决定，不是 children 顺序；对模板节点做 mount/move/unmount/replace
 * 返回 E-PAYLOAD（沿用既有诊断码，不为这条规则新增码）。
 *
 * changed：本次批量触碰到的「子树根 id」，按首次触碰顺序去重：
 * - update → 被更新的 id；
 * - mount → 新子树根 id；
 * - move → 被移动的 id；
 * - unmount → 被删除子树的旧根 id（已不在最终树里，但仍算触碰）；
 * - replace → 新子树根 id（旧根被替换；新旧 id 相同则只出现一次）。
 * 不是被触碰子树里的所有后代 id；渲染层用它决定重画哪些子树根。
 */

import { DOCUMENT_SCHEMA, DocumentError, parseDocument, type SlotNode } from "../contract/document";
import type { Diagnostic, DiagnosticCode } from "../contract/diagnostics";
import { DocumentIndex, documentErrorDiagnostic, type DocumentState } from "./document";
import { makeDiagnostic } from "../contract/diagnostics";
import { applyOp, buildLiveLocations, type LiveLocations, type Working } from "./ops_apply";
import { SYSTEM_REQUESTER, checkOpPermission, type RequesterOptions } from "./permissions";

/** 改一个节点的 props（浅合并）。 */
export interface UpdateOp {
  op: "update";
  id: string;
  props: Record<string, unknown>;
}

/** 在 slot 的 children 里插一棵子树；at 缺省 = 尾部。 */
export interface MountOp {
  op: "mount";
  slot: string;
  at?: number;
  node: SlotNode;
}

/** 把节点移动到 slot 的 at 位置。 */
export interface MoveOp {
  op: "move";
  id: string;
  slot: string;
  at: number;
}

/** 删除整棵子树。 */
export interface UnmountOp {
  op: "unmount";
  id: string;
}

/** 原位替换整棵子树。 */
export interface ReplaceOp {
  op: "replace";
  id: string;
  node: SlotNode;
}

/**
 * 树 op 联合：直接改根树内容 / 结构，由 `ops_apply.ts` 应用（它对 `Op` 做穷尽 switch）。
 * route 不在树修改层，所以这个联合里没有 route；线上批量用 `WireOp`。
 */
export type Op = UpdateOp | MountOp | MoveOp | UnmountOp | ReplaceOp;

/**
 * 路由意图：把会话切到 `page`，`params` 是给页面 / 路由用的附加参数。
 *
 * route 只影响会话侧表 `pages` / `active`，不碰根树，因此不在树修改层执行：
 * 会话层的 `applySessionOps` 负责校验目标页并设置 active；`applyOps` 遇到 route
 * 返回 E-PAYLOAD。
 */
export interface RouteOp {
  op: "route";
  page: string;
  params?: Record<string, unknown>;
}

/** 线上 op 全集：`ops` 批量里可以混 route。 */
export type WireOp = Op | RouteOp;

/** 归一化后的 ops 批量。 */
export interface OpsBatch {
  kind: "ops";
  document: number;
  base: number;
  seq: number;
  ops: WireOp[];
}

export type ParseOpsResult =
  { ok: true; batch: OpsBatch } | { ok: false; diagnostics: Diagnostic[] };

export type ApplyOpsResult =
  { ok: true; state: DocumentState; changed: string[] } | { ok: false; diagnostics: Diagnostic[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown, path: string, diagnostics: Diagnostic[]): string | undefined {
  if (typeof value !== "string" || value.trim() === "") {
    diagnostics.push(makeDiagnostic("E-PAYLOAD", "必须是非空字符串", { path }));
    return undefined;
  }
  return value;
}

function readInteger(
  value: unknown,
  path: string,
  diagnostics: Diagnostic[],
  minimum: number,
): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    diagnostics.push(makeDiagnostic("E-PAYLOAD", "必须是整数", { path }));
    return undefined;
  }
  if (value < minimum) {
    diagnostics.push(makeDiagnostic("E-PAYLOAD", "必须不小于 " + String(minimum), { path }));
    return undefined;
  }
  return value;
}

function readProps(
  value: unknown,
  path: string,
  diagnostics: Diagnostic[],
): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    diagnostics.push(makeDiagnostic("E-PAYLOAD", "props 必须是对象", { path }));
    return undefined;
  }
  return { ...value };
}

/** route 的 params：可选的普通对象；缺省（undefined）与空对象 `{}` 都合法且可区分。 */
function readParams(
  value: unknown,
  path: string,
  diagnostics: Diagnostic[],
): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    diagnostics.push(makeDiagnostic("E-PAYLOAD", "params 必须是对象", { path }));
    return undefined;
  }
  return { ...value };
}

function relativeDocumentPath(path: string): string {
  return path.startsWith("$.document") ? path.slice("$.document".length) : path;
}

/** 校验一棵 op 里的子树，成功返回与入参无关的深拷贝。 */
function readNode(value: unknown, path: string, diagnostics: Diagnostic[]): SlotNode | undefined {
  let parsed: SlotNode;
  try {
    parsed = parseDocument({
      schema: DOCUMENT_SCHEMA,
      document: value,
      pages: [],
      active: "",
      data: {},
      version: 1,
    }).document;
  } catch (error) {
    if (!(error instanceof DocumentError)) {
      throw error;
    }
    const code: DiagnosticCode = error.code === "duplicate_id" ? "E-ID-DUPLICATE" : "E-PAYLOAD";
    const diagnostic = documentErrorDiagnostic(error, path, "节点");
    diagnostics.push({
      ...diagnostic,
      code,
      path: path + relativeDocumentPath(error.path),
    });
    return undefined;
  }
  try {
    return structuredClone(parsed);
  } catch {
    diagnostics.push(makeDiagnostic("E-PAYLOAD", "node 必须只含可深拷的值（JSON 数据）", { path }));
    return undefined;
  }
}

function parseOp(value: unknown, path: string, diagnostics: Diagnostic[]): WireOp | undefined {
  if (!isRecord(value)) {
    diagnostics.push(makeDiagnostic("E-PAYLOAD", "op 必须是对象", { path }));
    return undefined;
  }
  if (typeof value.op !== "string" || value.op === "") {
    diagnostics.push(makeDiagnostic("E-PAYLOAD", "op 必须是非空字符串", { path: path + ".op" }));
    return undefined;
  }
  switch (value.op) {
    case "update": {
      const id = readString(value.id, path + ".id", diagnostics);
      const props = readProps(value.props, path + ".props", diagnostics);
      return id === undefined || props === undefined ? undefined : { op: "update", id, props };
    }
    case "mount": {
      const slot = readString(value.slot, path + ".slot", diagnostics);
      let at: number | undefined;
      if (value.at !== undefined) {
        at = readInteger(value.at, path + ".at", diagnostics, 0);
      }
      const node = readNode(value.node, path + ".node", diagnostics);
      if (slot === undefined || node === undefined) {
        return undefined;
      }
      return at === undefined ? { op: "mount", slot, node } : { op: "mount", slot, at, node };
    }
    case "move": {
      const id = readString(value.id, path + ".id", diagnostics);
      const slot = readString(value.slot, path + ".slot", diagnostics);
      const at = readInteger(value.at, path + ".at", diagnostics, 0);
      return id === undefined || slot === undefined || at === undefined
        ? undefined
        : { op: "move", id, slot, at };
    }
    case "unmount": {
      const id = readString(value.id, path + ".id", diagnostics);
      return id === undefined ? undefined : { op: "unmount", id };
    }
    case "replace": {
      const id = readString(value.id, path + ".id", diagnostics);
      const node = readNode(value.node, path + ".node", diagnostics);
      return id === undefined || node === undefined ? undefined : { op: "replace", id, node };
    }
    case "route": {
      const page = readString(value.page, path + ".page", diagnostics);
      let params: Record<string, unknown> | undefined;
      let paramsBroken = false;
      if (value.params !== undefined) {
        params = readParams(value.params, path + ".params", diagnostics);
        paramsBroken = params === undefined;
      }
      if (page === undefined || paramsBroken) {
        return undefined;
      }
      return params === undefined ? { op: "route", page } : { op: "route", page, params };
    }
    default:
      diagnostics.push(
        makeDiagnostic("E-PAYLOAD", "不认识的 op: " + value.op, { path: path + ".op" }),
      );
      return undefined;
  }
}

/** 校验 `{kind:"ops", document, base, seq, ops}` 与每种 op 的形状；失败返回诊断，不抛。 */
export function parseOps(value: unknown): ParseOpsResult {
  if (!isRecord(value)) {
    return {
      ok: false,
      diagnostics: [makeDiagnostic("E-PAYLOAD", "payload 必须是对象", { path: "$" })],
    };
  }
  const diagnostics: Diagnostic[] = [];
  if (value.kind !== "ops") {
    diagnostics.push(makeDiagnostic("E-PAYLOAD", "kind 必须是 ops", { path: "$.kind" }));
  }
  const document = readInteger(value.document, "$.document", diagnostics, 1);
  const base = readInteger(value.base, "$.base", diagnostics, 1);
  const seq = readInteger(value.seq, "$.seq", diagnostics, 0);
  if (!Array.isArray(value.ops)) {
    diagnostics.push(makeDiagnostic("E-PAYLOAD", "ops 必须是数组", { path: "$.ops" }));
    return { ok: false, diagnostics };
  }
  const ops: WireOp[] = [];
  value.ops.forEach((raw, index) => {
    const parsed = parseOp(raw, "$.ops[" + String(index) + "]", diagnostics);
    if (parsed !== undefined) {
      ops.push(parsed);
    }
  });
  if (diagnostics.length > 0 || document === undefined || base === undefined || seq === undefined) {
    return { ok: false, diagnostics };
  }
  return { ok: true, batch: { kind: "ops", document, base, seq, ops } };
}

function versionFailure(message: string, path: string): ApplyOpsResult {
  return { ok: false, diagnostics: [makeDiagnostic("E-VERSION", message, { path })] };
}

/**
 * 原子应用一批 ops。
 *
 * 先在根树深拷上顺序应用，任何一步失败都丢掉整棵副本、返回诊断；成功只给新状态
 * 与 changed。入参（state 与 batch）都不会被改写。
 */
export function applyOps(
  state: DocumentState,
  batch: OpsBatch,
  options: RequesterOptions = {},
): ApplyOpsResult {
  if (batch.base !== state.version) {
    return versionFailure(
      "base " + String(batch.base) + " 与当前文档版本 " + String(state.version) + " 不一致",
      "$.base",
    );
  }
  if (batch.document !== batch.base + 1) {
    return versionFailure(
      "document 必须是 base + 1（" +
        String(batch.base + 1) +
        "），实际是 " +
        String(batch.document),
      "$.document",
    );
  }
  const requester = options.requester ?? SYSTEM_REQUESTER;
  const working: Working = { root: structuredClone(state.root) };
  const changed: string[] = [];
  const touchedIds = new Set<string>();
  let index: DocumentIndex = DocumentIndex.build(working.root);
  let live: LiveLocations = buildLiveLocations(working.root);
  for (const [position, op] of batch.ops.entries()) {
    if (op.op === "route") {
      return {
        ok: false,
        diagnostics: [
          makeDiagnostic(
            "E-PAYLOAD",
            "route op 只能在会话层应用（applySessionOps），DocumentState 层不处理",
            { path: "$.ops[" + String(position) + "].op" },
          ),
        ],
      };
    }
    const denied = checkOpPermission(index, op, requester);
    if (denied !== undefined) {
      return { ok: false, diagnostics: [denied] };
    }
    const outcome = applyOp({ working, index, live }, op, "$.ops[" + String(position) + "]");
    if (!outcome.ok) {
      return { ok: false, diagnostics: [outcome.diagnostic] };
    }
    if (!touchedIds.has(outcome.touched)) {
      touchedIds.add(outcome.touched);
      changed.push(outcome.touched);
    }
    // 每步都从工作树重建索引：索引与树一致是构造出来的，不做增量对齐。
    index = DocumentIndex.build(working.root);
    live = buildLiveLocations(working.root);
  }
  return { ok: true, state: { root: working.root, version: batch.document }, changed };
}

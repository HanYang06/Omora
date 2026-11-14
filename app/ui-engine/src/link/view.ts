/**
 * `view` payload 的校验器（S6 主会话）。
 *
 * 主会话交的是「局部树 + 页面侧表 + 数据文档 + 版本」：权威根树仍由 TS 链接器在本地
 * 链接，Python 不产出整棵根树。local-trees 部分复用 `parseLocalTrees`（同一套 Slot
 * 校验与全局 id 唯一），这里只补视图信封：kind / schema / version / pages / active / data。
 *
 * 失败返回诊断、不抛：调用方拿到诊断就整份拒收，不产生半成品视图。
 */

import { DOCUMENT_SCHEMA, type PageEntry } from "../contract/document";
import type { Diagnostic } from "../contract/diagnostics";
import { makeDiagnostic } from "../contract/diagnostics";
import { parseLocalTrees, sortDiagnostics } from "./parse";
import type { LocalTreesPayload } from "./types";

/** 主会话视图：局部树 + 页面侧表 + 数据文档 + 版本。 */
export interface ViewPayload {
  kind: "view";
  schema: string;
  version: number;
  localTrees: LocalTreesPayload;
  pages: PageEntry[];
  active: string;
  data: Record<string, unknown>;
}

export type ParseViewResult =
  { ok: true; view: ViewPayload } | { ok: false; diagnostics: Diagnostic[] };

const PAYLOAD_CODE = "E-PAYLOAD";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(
  value: unknown,
  path: string,
  diagnostics: Diagnostic[],
  allowEmpty = false,
): string | undefined {
  if (typeof value !== "string" || (!allowEmpty && value.trim() === "")) {
    diagnostics.push(
      makeDiagnostic(PAYLOAD_CODE, allowEmpty ? "必须是字符串" : "必须是非空字符串", { path }),
    );
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
    diagnostics.push(makeDiagnostic(PAYLOAD_CODE, "必须是整数", { path }));
    return undefined;
  }
  if (value < minimum) {
    diagnostics.push(makeDiagnostic(PAYLOAD_CODE, `必须不小于 ${String(minimum)}`, { path }));
    return undefined;
  }
  return value;
}

function readPage(value: unknown, path: string, diagnostics: Diagnostic[]): PageEntry | undefined {
  if (!isRecord(value)) {
    diagnostics.push(makeDiagnostic(PAYLOAD_CODE, "页面必须是对象", { path }));
    return undefined;
  }
  const id = readString(value.id, path + ".id", diagnostics);
  const label = readString(value.label, path + ".label", diagnostics);
  const route = readString(value.route, path + ".route", diagnostics);
  const owner = readString(value.owner, path + ".owner", diagnostics);
  let icon: string | undefined;
  if (value.icon !== undefined) {
    icon = readString(value.icon, path + ".icon", diagnostics);
  }
  if (
    id === undefined ||
    label === undefined ||
    route === undefined ||
    owner === undefined ||
    (value.icon !== undefined && icon === undefined)
  ) {
    return undefined;
  }
  const page: PageEntry = { id, label, route, owner };
  if (icon !== undefined) {
    page.icon = icon;
  }
  return page;
}

function readPages(value: unknown, diagnostics: Diagnostic[]): PageEntry[] | undefined {
  if (!Array.isArray(value)) {
    diagnostics.push(makeDiagnostic(PAYLOAD_CODE, "pages 必须是数组", { path: "$.pages" }));
    return undefined;
  }
  const pages: PageEntry[] = [];
  const seen = new Set<string>();
  value.forEach((rawPage, index) => {
    const path = `$.pages[${String(index)}]`;
    const page = readPage(rawPage, path, diagnostics);
    if (page === undefined) {
      return;
    }
    if (seen.has(page.id)) {
      diagnostics.push(
        makeDiagnostic("E-ID-DUPLICATE", `重复页面 id: ${page.id}`, { path: path + ".id" }),
      );
      return;
    }
    seen.add(page.id);
    pages.push(page);
  });
  return pages;
}

/**
 * 校验一份主会话视图。
 *
 * 顺序：信封（kind / schema / version）→ local-trees → 页面侧表 → active 必须在 pages 里
 * → data 必须是对象。诊断与 local-trees 解析同款（E-PAYLOAD / E-ID-DUPLICATE /
 * E-TARGET-MISSING），最终按固定顺序排序。
 */
export function parseView(value: unknown): ParseViewResult {
  const diagnostics: Diagnostic[] = [];
  if (!isRecord(value)) {
    return {
      ok: false,
      diagnostics: [makeDiagnostic(PAYLOAD_CODE, "payload 必须是对象", { path: "$" })],
    };
  }
  if (value.kind !== "view") {
    diagnostics.push(makeDiagnostic(PAYLOAD_CODE, "kind 必须是 view", { path: "$.kind" }));
  }
  if (value.schema !== DOCUMENT_SCHEMA) {
    diagnostics.push(
      makeDiagnostic(PAYLOAD_CODE, `schema 必须是 ${DOCUMENT_SCHEMA}`, { path: "$.schema" }),
    );
  }
  const version = readInteger(value.version, "$.version", diagnostics, 1);

  const localTrees = parseLocalTrees(value.localTrees);
  if (!localTrees.ok) {
    diagnostics.push(...localTrees.diagnostics);
  }
  const pages = readPages(value.pages, diagnostics);
  const active = readString(value.active, "$.active", diagnostics, true);

  let data: Record<string, unknown> | undefined;
  if (!isRecord(value.data)) {
    diagnostics.push(makeDiagnostic(PAYLOAD_CODE, "data 必须是对象", { path: "$.data" }));
  } else {
    data = { ...value.data };
  }

  if (pages !== undefined && active !== undefined) {
    if (pages.length === 0) {
      if (active !== "") {
        diagnostics.push(
          makeDiagnostic(PAYLOAD_CODE, "没有页面时 active 必须是空串", { path: "$.active" }),
        );
      }
    } else if (!pages.some((page) => page.id === active)) {
      diagnostics.push(
        makeDiagnostic("E-TARGET-MISSING", `active 不在 pages 里: ${active}`, {
          path: "$.active",
        }),
      );
    }
  }

  if (
    diagnostics.length > 0 ||
    version === undefined ||
    !localTrees.ok ||
    pages === undefined ||
    active === undefined ||
    data === undefined
  ) {
    return { ok: false, diagnostics: sortDiagnostics(diagnostics) };
  }
  return {
    ok: true,
    view: {
      kind: "view",
      schema: DOCUMENT_SCHEMA,
      version,
      localTrees: localTrees.payload,
      pages,
      active,
      data,
    },
  };
}

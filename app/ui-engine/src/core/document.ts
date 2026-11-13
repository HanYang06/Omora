/**
 * Dendrolink v2 文档契约（S1.1）。
 *
 * 只定义线上形状与校验，不接入现有 v1 渲染；与 Python 的 `omora.sdk.document`
 * 共用 `app/sdk/tests/fixtures/document.json`。
 */

export const DOCUMENT_SCHEMA = "dendro.ui/1";

export type LayoutFlow = "column" | "row" | "stack" | "none";
export type Capacity = "none" | "one" | "many";
export type Align = "start" | "center" | "stretch";
export type Scroll = "none" | "x" | "y";

export interface Layout {
  flow: LayoutFlow;
  capacity: Capacity;
  size?: Record<string, string | number>;
  gap?: string;
  align?: Align;
  scroll?: Scroll;
}

export interface Input {
  source: string;
  path?: string;
}

export interface Reaction {
  on: Record<string, unknown>;
  do: Record<string, unknown>[];
}

export interface Collection {
  source: string;
  key: string;
  templates: Record<string, SlotNode>;
  select: string;
}

export interface Grant {
  capabilities: Record<string, string[]>;
}

export interface SlotNode {
  id: string;
  kind: string;
  owner: string;
  props: Record<string, unknown>;
  children: SlotNode[];
  scope?: string;
  bind?: Record<string, string>;
  layout?: Layout;
  in?: Input[];
  events?: Record<string, string>;
  reactions?: Reaction[];
  collection?: Collection;
  grant?: Grant;
}

export interface PageEntry {
  id: string;
  label: string;
  route: string;
  owner: string;
  icon?: string;
}

export interface SlotDocument {
  schema: string;
  document: SlotNode;
  pages: PageEntry[];
  active: string;
  data: Record<string, unknown>;
  version: number;
}

export class DocumentError extends Error {
  readonly code: string;
  readonly path: string;

  constructor(code: string, path: string, message: string) {
    super(code + " @ " + path + ": " + message);
    this.name = "DocumentError";
    this.code = code;
    this.path = path;
  }
}

const FLOWS = new Set<string>(["column", "row", "stack", "none"]);
const CAPACITIES = new Set<string>(["none", "one", "many"]);
const ALIGNS = new Set<string>(["start", "center", "stretch"]);
const SCROLLS = new Set<string>(["none", "x", "y"]);
const CAPABILITIES = new Set<string>([
  "read",
  "mount",
  "replace",
  "update",
  "remove",
  "observe",
  "intercept",
]);

function fail(code: string, path: string, message: string): never {
  throw new DocumentError(code, path, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, code: string, path: string): Record<string, unknown> {
  if (!isRecord(value)) {
    fail(code, path, "必须是对象");
  }
  return value;
}

function requireString(value: unknown, code: string, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    fail(code, path, "必须是非空字符串");
  }
  return value;
}

function requireInteger(value: unknown, code: string, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    fail(code, path, "必须是整数");
  }
  return value;
}

function parseBind(value: unknown, path: string): Record<string, string> {
  const record = requireRecord(value, "bad_bind", path);
  const bind: Record<string, string> = {};
  for (const [name, target] of Object.entries(record)) {
    requireString(name, "bad_bind", path + " 的键");
    bind[name] = requireString(target, "bad_bind", path + "." + name);
  }
  return bind;
}

function parseLayout(value: unknown, path: string): Layout {
  const record = requireRecord(value, "bad_layout", path);
  const flow = requireString(record.flow, "bad_layout", path + ".flow");
  if (!FLOWS.has(flow)) {
    fail("bad_layout", path + ".flow", "不认识的 flow: " + flow);
  }
  const capacity = requireString(record.capacity, "bad_layout", path + ".capacity");
  if (!CAPACITIES.has(capacity)) {
    fail("bad_layout", path + ".capacity", "不认识的 capacity: " + capacity);
  }
  const layout: Layout = { flow: flow as LayoutFlow, capacity: capacity as Capacity };
  if (record.size !== undefined) {
    const size = requireRecord(record.size, "bad_layout", path + ".size");
    const copy: Record<string, string | number> = {};
    for (const [name, raw] of Object.entries(size)) {
      requireString(name, "bad_layout", path + ".size 的键");
      if (typeof raw !== "string" && typeof raw !== "number") {
        fail("bad_layout", path + ".size." + name, "必须是字符串或数字");
      }
      copy[name] = raw;
    }
    layout.size = copy;
  }
  if (record.gap !== undefined) {
    layout.gap = requireString(record.gap, "bad_layout", path + ".gap");
  }
  if (record.align !== undefined) {
    const align = requireString(record.align, "bad_layout", path + ".align");
    if (!ALIGNS.has(align)) {
      fail("bad_layout", path + ".align", "不认识的 align: " + align);
    }
    layout.align = align as Align;
  }
  if (record.scroll !== undefined) {
    const scroll = requireString(record.scroll, "bad_layout", path + ".scroll");
    if (!SCROLLS.has(scroll)) {
      fail("bad_layout", path + ".scroll", "不认识的 scroll: " + scroll);
    }
    layout.scroll = scroll as Scroll;
  }
  return layout;
}

function parseInputs(value: unknown, path: string): Input[] {
  if (!Array.isArray(value)) {
    fail("bad_input", path, "必须是数组");
  }
  return value.map((item, index) => {
    const at = path + "[" + String(index) + "]";
    const record = requireRecord(item, "bad_input", at);
    const input: Input = { source: requireString(record.source, "bad_input", at + ".source") };
    if (record.path !== undefined) {
      input.path = requireString(record.path, "bad_input", at + ".path");
    }
    return input;
  });
}

function parseReactions(value: unknown, path: string): Reaction[] {
  if (!Array.isArray(value)) {
    fail("bad_reaction", path, "必须是数组");
  }
  return value.map((item, index) => {
    const at = path + "[" + String(index) + "]";
    const record = requireRecord(item, "bad_reaction", at);
    const trigger = requireRecord(record.on, "bad_reaction", at + ".on");
    if (Object.keys(trigger).length !== 1) {
      fail("bad_reaction", at + ".on", "必须只有一个触发键");
    }
    if (!Array.isArray(record.do) || record.do.length === 0) {
      fail("bad_reaction", at + ".do", "必须是非空数组");
    }
    const effects = record.do.map((effect, effectIndex) => {
      const effectRecord = requireRecord(
        effect,
        "bad_reaction",
        at + ".do[" + String(effectIndex) + "]",
      );
      if (Object.keys(effectRecord).length === 0) {
        fail("bad_reaction", at + ".do[" + String(effectIndex) + "]", "不能是空对象");
      }
      return { ...effectRecord };
    });
    return { on: { ...trigger }, do: effects };
  });
}

function parseGrant(value: unknown, path: string): Grant {
  const record = requireRecord(value, "bad_grant", path);
  const capabilities: Record<string, string[]> = {};
  for (const [name, subjects] of Object.entries(record)) {
    if (!CAPABILITIES.has(name)) {
      fail("bad_grant", path + "." + name, "未知能力");
    }
    if (!Array.isArray(subjects)) {
      fail("bad_grant", path + "." + name, "必须是字符串数组");
    }
    capabilities[name] = subjects.map((subject, index) =>
      requireString(subject, "bad_grant", path + "." + name + "[" + String(index) + "]"),
    );
  }
  return { capabilities };
}

function parseCollection(value: unknown, path: string, seen: Set<string>): Collection {
  const record = requireRecord(value, "bad_collection", path);
  const templatesRaw = requireRecord(record.templates, "bad_collection", path + ".templates");
  if (Object.keys(templatesRaw).length === 0) {
    fail("bad_collection", path + ".templates", "不能为空");
  }
  const templates: Record<string, SlotNode> = {};
  for (const [name, template] of Object.entries(templatesRaw)) {
    requireString(name, "bad_collection", path + ".templates 的键");
    templates[name] = parseSlot(template, seen, path + ".templates." + name);
  }
  return {
    source: requireString(record.source, "bad_collection", path + ".source"),
    key: requireString(record.key, "bad_collection", path + ".key"),
    templates,
    select: requireString(record.select, "bad_collection", path + ".select"),
  };
}

function parseEvents(value: unknown, path: string): Record<string, string> {
  const record = requireRecord(value, "bad_events", path);
  const events: Record<string, string> = {};
  for (const [name, handler] of Object.entries(record)) {
    requireString(name, "bad_events", path + " 的事件名");
    events[name] = requireString(handler, "bad_events", path + "." + name);
  }
  return events;
}

function parseSlot(value: unknown, seen: Set<string>, path: string): SlotNode {
  const record = requireRecord(value, "bad_slot", path);
  const id = requireString(record.id, "bad_id", path + ".id");
  if (seen.has(id)) {
    fail("duplicate_id", path + ".id", "重复 id: " + id);
  }
  seen.add(id);
  const kind = requireString(record.kind, "bad_kind", path + ".kind");
  const kindParts = kind.split(":");
  if (kindParts.length !== 2 || kindParts.some((part) => part.trim() === "")) {
    fail("bad_kind", path + ".kind", "必须是 命名空间:名字，实际是 " + kind);
  }
  const owner = requireString(record.owner, "bad_owner", path + ".owner");
  const props = requireRecord(record.props, "bad_props", path + ".props");
  if (!Array.isArray(record.children)) {
    fail("bad_slot", path + ".children", "必须是数组");
  }
  const children = record.children.map((child, index) =>
    parseSlot(child, seen, path + ".children[" + String(index) + "]"),
  );
  const slot: SlotNode = { id, kind, owner, props: { ...props }, children };
  if (record.scope !== undefined) {
    slot.scope = requireString(record.scope, "bad_scope", path + ".scope");
  }
  if (record.bind !== undefined) {
    slot.bind = parseBind(record.bind, path + ".bind");
  }
  if (record.layout !== undefined) {
    slot.layout = parseLayout(record.layout, path + ".layout");
  }
  if (record.in !== undefined) {
    slot.in = parseInputs(record.in, path + ".in");
  }
  if (record.events !== undefined) {
    slot.events = parseEvents(record.events, path + ".events");
  }
  if (record.reactions !== undefined) {
    slot.reactions = parseReactions(record.reactions, path + ".reactions");
  }
  if (record.collection !== undefined) {
    slot.collection = parseCollection(record.collection, path + ".collection", seen);
  }
  if (record.grant !== undefined) {
    slot.grant = parseGrant(record.grant, path + ".grant");
  }
  return slot;
}

function parsePage(value: unknown, path: string): PageEntry {
  const record = requireRecord(value, "bad_page", path);
  const page: PageEntry = {
    id: requireString(record.id, "bad_page", path + ".id"),
    label: requireString(record.label, "bad_page", path + ".label"),
    route: requireString(record.route, "bad_page", path + ".route"),
    owner: requireString(record.owner, "bad_page", path + ".owner"),
  };
  if (record.icon !== undefined) {
    page.icon = requireString(record.icon, "bad_page", path + ".icon");
  }
  return page;
}

/** 校验一份 v2 文档；不合法抛 DocumentError，合法返回规范化对象。 */
export function parseDocument(value: unknown): SlotDocument {
  const record = requireRecord(value, "bad_document", "$");
  const schema = requireString(record.schema, "bad_schema", "$.schema");
  if (schema !== DOCUMENT_SCHEMA) {
    fail("bad_schema", "$.schema", "必须是 " + DOCUMENT_SCHEMA + "，实际是 " + schema);
  }
  const version = requireInteger(record.version, "bad_version", "$.version");
  if (version < 1) {
    fail("bad_version", "$.version", "必须是正整数");
  }
  const data = requireRecord(record.data, "bad_data", "$.data");
  if (!Array.isArray(record.pages)) {
    fail("bad_pages", "$.pages", "必须是数组");
  }
  const pages = record.pages.map((page, index) =>
    parsePage(page, "$.pages[" + String(index) + "]"),
  );
  const pageIds = new Set<string>();
  for (const page of pages) {
    if (pageIds.has(page.id)) {
      fail("duplicate_page", "$.pages", "重复页面 id: " + page.id);
    }
    pageIds.add(page.id);
  }
  if (typeof record.active !== "string") {
    fail("bad_active", "$.active", "必须是字符串");
  }
  const active = record.active;
  if (pages.length > 0) {
    if (!pageIds.has(active)) {
      fail("bad_active", "$.active", "active 不在 pages 里: " + active);
    }
  } else if (active !== "") {
    fail("bad_active", "$.active", "没有页面时 active 必须是空串");
  }
  const seen = new Set<string>();
  const root = parseSlot(record.document, seen, "$.document");
  return { schema, document: root, pages, active, data: { ...data }, version };
}

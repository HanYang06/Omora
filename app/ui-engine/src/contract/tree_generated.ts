// 生成物：树格式 V1 的 TS 类型、常量与 schema。不要手改。
// 来源：schema/tree/tree.schema.json；重新生成：
//   uv run python scripts/tree_schema.py

export interface Placement {
  size?: Record<string, string | number>;
  align?: "start" | "center" | "stretch";
  span?: number;
}

export interface A11y {
  role?: string;
  label?: string;
  description?: string;
}

export interface Node {
  id: string;
  chain: string;
  kind: string;
  order: number;
  layout: Node[];
  settings: Record<string, unknown>;
  bind: Record<string, unknown>;
  on: Record<string, unknown>;
  emit: Record<string, unknown>;
  title?: string;
  slot?: Placement;
  collection?: Collection;
  a11y?: A11y;
}

export interface Page {
  id: string;
  title: string;
  route: string;
}

export interface LedgerEntry {
  source: string;
  fields?: Record<string, string>;
}

export interface Mount {
  parent: string;
  mode: "new" | "overlay";
}

export interface Collection {
  source: string;
  key: string;
  templates: Record<string, Node>;
  select?: string;
}

export interface Document {
  schema: string;
  version: number;
  root: Node;
  pages: Page[];
  active: string;
  data: Record<string, unknown>;
  ledger?: Record<string, LedgerEntry>;
}

export interface Partial {
  schema: string;
  source: string;
  mount: Mount;
  root: Node;
}

export const TREE_SCHEMA = JSON.parse(
  String.raw`{"$schema":"https://json-schema.org/draft/2020-12/schema","$id":"https://omora.dev/schema/dendro.tree/1","title":"Dendrolink Tree V1","description":"Dendrolink tree format V1. One Node primitive; only layout nests mounted nodes (collection.templates holds unmounted template trees). Partials mount by stable node id; documents add pages/active/data/ledger. This file is the single source for fields, types and structural roles.","oneOf":[{"$ref":"#/$defs/document"},{"$ref":"#/$defs/partial"},{"$ref":"#/$defs/node"}],"$defs":{"id":{"type":"string","pattern":"^[0-9a-f]{16}$","description":"稳定身份：16 位小写十六进制；出生后不变。"},"chain":{"type":"string","pattern":"^[0-9a-f]{16}(\\.[0-9a-f]{16})*$","description":"结构地址：父 chain + '.' + id；根 chain 等于 id。"},"placement":{"type":"object","additionalProperties":false,"properties":{"size":{"type":"object","additionalProperties":false,"properties":{"width":{"type":["string","number"]},"height":{"type":["string","number"]}}},"align":{"enum":["start","center","stretch"]},"span":{"type":"integer","minimum":1}}},"mount":{"type":"object","additionalProperties":false,"required":["parent","mode"],"properties":{"parent":{"$ref":"#/$defs/id"},"mode":{"enum":["new","overlay"]}}},"node":{"type":"object","additionalProperties":false,"required":["id","chain","kind","order","layout","settings","bind","on","emit"],"properties":{"id":{"$ref":"#/$defs/id"},"chain":{"$ref":"#/$defs/chain"},"kind":{"type":"string","minLength":1},"title":{"type":"string","minLength":1},"order":{"type":"integer","minimum":0},"layout":{"type":"array","items":{"$ref":"#/$defs/node"}},"slot":{"$ref":"#/$defs/placement"},"settings":{"type":"object"},"bind":{"type":"object"},"on":{"type":"object"},"emit":{"type":"object"},"collection":{"$ref":"#/$defs/collection"},"a11y":{"$ref":"#/$defs/a11y"}}},"a11y":{"type":"object","description":"作者声明的无障碍语义：渲染器落到元素上，覆盖组件默认值。只接语义，不接 CSS。","additionalProperties":false,"properties":{"role":{"type":"string","minLength":1},"label":{"type":"string","minLength":1},"description":{"type":"string","minLength":1}}},"collection":{"type":"object","description":"数据驱动的子节点：树里声明模板，数据按 key 填充。source 是数据源，key 是条目身份字段，select 是条目里选模板的字段（缺省 template），templates 是具名模板（不挂载的子树）。","additionalProperties":false,"required":["source","key","templates"],"properties":{"source":{"type":"string","minLength":1},"key":{"type":"string","minLength":1},"select":{"type":"string","minLength":1},"templates":{"type":"object","minProperties":1,"additionalProperties":{"$ref":"#/$defs/node"}}}},"page":{"type":"object","additionalProperties":false,"required":["id","title","route"],"properties":{"id":{"$ref":"#/$defs/id"},"title":{"type":"string","minLength":1},"route":{"type":"string","minLength":1}}},"ledgerEntry":{"type":"object","additionalProperties":false,"required":["source"],"properties":{"source":{"type":"string","minLength":1},"fields":{"type":"object","additionalProperties":{"type":"string","minLength":1}}}},"document":{"type":"object","additionalProperties":false,"required":["schema","version","root","pages","active","data"],"properties":{"schema":{"const":"dendro.tree/1"},"version":{"type":"integer","minimum":1},"root":{"allOf":[{"$ref":"#/$defs/node"},{"type":"object","properties":{"kind":{"const":"app"}}}]},"pages":{"type":"array","items":{"$ref":"#/$defs/page"}},"active":{"type":"string"},"data":{"type":"object"},"ledger":{"type":"object","additionalProperties":{"$ref":"#/$defs/ledgerEntry"}}}},"partial":{"type":"object","additionalProperties":false,"required":["schema","source","mount","root"],"properties":{"schema":{"const":"dendro.tree/1"},"source":{"type":"string","minLength":1},"mount":{"$ref":"#/$defs/mount"},"root":{"$ref":"#/$defs/node"}}}},"x-omora":{"idField":"id","chainField":"chain","orderField":"order","layoutField":"layout","nonNestingFields":["settings","bind","on","emit"],"rootKind":"app","mountModes":["new","overlay"]}}`,
) as unknown;

export const TREE_SCHEMA_ID = "https://omora.dev/schema/dendro.tree/1";
export const TREE_ID_PATTERN = "^[0-9a-f]{16}$";
export const TREE_ID_FIELD = "id";
export const TREE_CHAIN_FIELD = "chain";
export const TREE_ORDER_FIELD = "order";
export const TREE_LAYOUT_FIELD = "layout";
export const TREE_NON_NESTING_FIELDS = ["settings", "bind", "on", "emit"] as const;
export const TREE_ROOT_KIND = "app";
export const TREE_MOUNT_MODES = ["new", "overlay"] as const;

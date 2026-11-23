# V1 更新操作（ops）

> 状态：**现状**（2026-11-22）。形状 + 文档层应用 + 运行时最小更新 /
> `data` 文档层已落。Python 的 `tree_event` 产线只发 `setProps` / `mount` / `unmount`，
> 表达不了就回整树；`replace` 形状与应用端已实现但产线未发；
> `data` 由 `PageHandle.data` 单独发（不经过差分），`changes` 增量还没接。
> 相关：[V1 树](../planning/v1-tree.md) · [V1 运行时](tree-runtime.md) · [wire](wire.md)

## 0. 一句话

ops 是“按 id 改一份已存在的 `dendro.tree/1` 文档”的批量：不重链、不重传整棵树，
只带被改的节点与数据。一次批量一个版本，要么全成，要么全不成。

## 1. 线上形状

```jsonc
{
  "kind": "ops",
  "document": 8, // 新版本
  "base": 7,     // 客户端当前版本；document 必须 = base + 1
  "seq": 42,     // 来源内声明序
  "ops": [
    { "op": "setProps", "id": "…", "props": { "text": "新入口" } },
    { "op": "mount", "parent": "…", "node": { /* dendro.tree/1 node */ } },
    { "op": "unmount", "id": "…" },
    { "op": "replace", "id": "…", "node": { /* 新子树 */ } },
    { "op": "data", "source": "ideas.feed", "revision": 6, "items": [ … ] }
  ]
}
```

五种 op：

| op         | 载荷                                                   | 语义（应用端实现）                                               |
| ---------- | ------------------------------------------------------ | ---------------------------------------------------------------- |
| `setProps` | `id` + `props`                                         | 浅合并进节点的 `settings`；未提到的键保留                        |
| `mount`    | `parent` + `node`                                      | 挂到父节点 layout；位置由 `node.order` 决定（同级 order 唯一）   |
| `unmount`  | `id`                                                   | 摘掉整棵子树；根不能卸                                           |
| `replace`  | `id` + `node`                                          | 原位替换；id 可换，chain 由应用端按父链校验                      |
| `data`     | `source` + `revision` + `value`/`items`/`changes` 之一 | 纯数据；写 `data[source] = {revision, value \| items}`，不改结构 |

- 空 `ops` 合法：不改变结构，但仍推进版本。
- 节点载荷仍是完整 `dendro.tree/1` node（带 chain）；ops 不另造一套节点形状。
- `data` 的三种载荷与 Slot 时期的 data 形状同义：标量 `value`、全量 `items`、
  增量 `changes`（`changes` 产线未接，遇到整批 `E-PAYLOAD`）。

## 2. 版本与失败

- `base` 必须等于当前文档版本，`document` 必须等于 `base + 1`，否则 `E-VERSION`，整批不生效。
- 任一 op 失败 → 整批不生效、原文档与 DOM 不变；调用方可以请求全量文档兜底。
- 形状错误一律 `E-PAYLOAD`，诊断带 payload 的 JSON Pointer，按 (path, code, message) 排序。
- 应用端要在**路径复制**的文档上做：只复制被触碰节点的祖先，未触碰兄弟保持原引用；
  DOM 只 patch 被触碰的子树根。

## 3. 跨语言契约

`app/sdk/tests/fixtures/tree-ops.json` 是唯一契约：

- Python `omora.sdk.tree_ops.serialize_ops` 的输出必须与 fixture 完全相等；
- TS `engine/tree/ops.parseOps` 必须接受同一份 fixture，并给出相同的五个 op。

## 4. 已落 / 还没做

已落：

- `applyOps`（文档层）：`base` 版本判定、目标预检、路径复制（未触碰兄弟保持原引用）、
  原子回滚、`changed`（被触碰的子树根 id，按首次触碰去重）。
- 结构校验：mount / replace 的 chain 必须由目标父链推出；id 不与现有节点冲突；
  同级 order 唯一；replace 不能改 order、根不能做结构操作。
- 模板边界：`collection.templates` 里的节点可以 `setProps`，但不能 mount / unmount / replace。
- `data` 文档层：把 `data[source]` 写成 `{revision, value}` 或 `{revision, items}`；
  revision 相等是幂等 no-op、更小是过期（忽略并记 `E-DATA-STALE`）、更大才应用。
  只改文档数据，不改结构、不进 `changed`；`changes` 增量还没接，遇到整批 `E-PAYLOAD`。
- 运行时没有 data 的 patch 阶段：数据不进 `changed`，已挂载节点一个不动。
- 运行时 `setProps`（内容更新）：只替换目标已挂载节点的 `node` 引用并 `update` 渲染器；
  元素复用、兄弟不动；版本 / 原子失败沿用文档层，失败时整批不生效。
- 运行时 `mount / unmount`：新子树先全部建好再放，只动目标子树；兄弟元素引用不变。
  一次批量里不允许嵌套 mount（新子树应自带子节点），也不允许对同一 id 先摘后挂。
- 运行时 `replace`：先把旧子树摘下，再在同一个父下按 `order` 放新子树；id 可以换。
  一次批量只支持一个 replace（链式 replace 下一步）。

已接的 `data` 产线：

- 发射端：`PageHandle.data(source, value=… | items=…)` 直接产一帧 data op
  （revision 按 source 递增），整树 / 重连时 `base.data` 带同一份快照。
- 编写端：`Collection(source, key, templates)` + `bound(node, prop="item.x")`，
  ideas 的 rail / feed 各用一个 source，列表条目不再进页面节点。

还没做：

- `changes` 增量：仍然遇整批 `E-PAYLOAD`；现在每次发 items 全量（字节 O(N)）。
- `replace` 的产线：形状与应用端已落，`tree_event` 差分暂不产。
- 权限 / 审计：不在引擎，归宿主策略（V1 宿主侧还没接）。

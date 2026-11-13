# 寻址：id、索引与更新集合

> 状态：**已定**；S3-a 已落三张索引（`DocumentIndex`），运行时更新管线与来源/路径级索引待接。本文定义全寻址：id 怎么来、引擎维护哪些索引、更新怎么定位。
> 依赖：[contract.md](contract.md)
> 相关：[structure.md](structure.md) · [updates.md](updates.md) · [permissions.md](permissions.md)

## 0. 一句话

每个 Slot 都有稳定 id；引擎维护三张索引；一次更新按 id 或 slot id 定位，不按“从根算出来的路径”。

## 1. 一个 id 空间，三种来源

| 来源                   | 规则                                | 稳定性             |
| ---------------------- | ----------------------------------- | ------------------ |
| 公开 slot / 可介入节点 | 作者声明（沿用键生成器）            | 跨版本、跨换页稳定 |
| 私有节点 / 叶子        | 引擎派生：owner + 语义路径 + 数据键 | 会话内稳定         |
| 列表项                 | `slotId#itemKey`，由数据 key 派生   | 跨数据更新稳定     |

规则：

1. **全局唯一**：同 id 出现两次是 `E-ID-DUPLICATE`，不静默取第一个。
2. **稳定优先于简短**：同一个逻辑组件跨重画、跨换页必须保持同一 id，否则局部状态与补丁都会错位。
3. **列表项必须来自数据 key**，不能用数组下标；下标一插入就漂移。
4. 派生 id 的算法版本化；改算法属于契约变更。

## 2. 三张索引

| 索引                         | 内容                    | 消费者                            |
| ---------------------------- | ----------------------- | --------------------------------- |
| `id → Slot`                  | O(1) 定位               | 更新、事件、权限、调试            |
| `id → (parent, slot, order)` | 反查位置、层归属、深度  | move / unmount / 布局、层叠上下文 |
| `source/path → [slot ids]`   | 一条数据被谁消费（1:N） | 数据更新、最小重渲染              |

索引由引擎维护，不落线上树；全量重建与增量更新都必须让三张索引保持一致。

## 3. 更新集合：寻址粒度

一次更新可以是：

- `subtree(id)`：一个 Slot 及其子树；
- `batch([id…])`：多个 Slot，一个事务；
- `node(id/child)`：一个具体节点（不碰它的子树）。

更新集合是**事务范围**，不是第四种更新类型。一次集合原子应用、只涨一个版本、只渲染一次。

## 4. 全寻址 ≠ 可介入

- 引擎内部对**所有** Slot 全寻址，这是运行时能力。
- 外部来源只能看到被 `grant` 暴露的 slot；写对 id 不等于有权限，闸门在引擎 API 上。
- 私有子树的 id 不对外暴露，也不可被其他来源的组合输入引用。

## 5. 诊断

| 码                 | 场景                             |
| ------------------ | -------------------------------- |
| `E-ID-DUPLICATE`   | 两个来源派生出同一个 id          |
| `E-ID-INVALID`     | id 不符合命名规则 / 为空         |
| `E-TARGET-MISSING` | 更新指向不存在的 slot / 节点     |
| `E-OWNERSHIP`      | 更新者不拥有该节点或不在允许范围 |

## 6. 示例

```jsonc
{
  "document": 17,
  "ops": [
    { "op": "update", "id": "ideas.search", "props": { "value": "录音" } },
    { "op": "mount", "slot": "ideas.feed", "at": 0, "node": { "id": "ideas.feed#42" } },
    { "op": "move", "id": "ideas.feed#42", "slot": "ideas.rail", "at": 3 },
    { "op": "unmount", "id": "ideas.feed#7" },
  ],
}
```

## 7. 未定

- 非列表节点的派生 id 算法细节（语义路径的规范化、数据键的选择）；
- id 改名/迁移（发布后公开 id 的破坏性变更规则）；
- 多客户端会话下的 id 可见性与隔离。

## 8. S3-a 实现（已落）

- 代码：`app/ui-engine/src/engine/document/document.ts` 的 `DocumentIndex`，从根树独立重建；`ops.ts` 每次应用批量后重建（一致性是构造出来的，不做增量对齐）。
- 索引三项：`get(id)`、`parentOf(id) → {parentId, order}`、`slotsFor(source) → [id]`（`in[].source` 与 `collection.source` 都算消费）。
- 全寻址包含 `collection.templates` 里的模板子树：可 `get`、可 update 内容；模板根 `parentOf.order = -1`（命名表位置，不是 children 序号），`childrenOf(集合 slot)` 不含模板根。
- 未接：`source/path → slots` 的路径级细分、反查索引驱动渲染/事件、跨更新增量维护（当前每步重建，先保证正确性）。

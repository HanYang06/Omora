# 集合绑定：用数据实例化已声明的结构

> 状态：**建议**（作者已认同方向，细节未定稿）。
> 依赖：[contract.md](contract.md) · [addressing.md](addressing.md) · [rules.md](rules.md)
> 相关：[updates.md](updates.md) · [composition.md](composition.md)

## 0. 一句话

列表不是模板语言，而是 Slot 上的一个闭合结构原语：**树里声明模板，数据只负责按 key 填充**。

## 1. 为什么

- 加一条条目时，来源不应该为了这一条重新组一棵条目子树；数据只发字段值。
- 同构条目应该由同一个模板渲染，天然一致，不会每个条目各写各的。
- 条目身份由数据 key 决定，跨更新稳定，局部状态不丢。

## 2. 形状

```jsonc
{
  "id": "ideas.main.feed",
  "kind": "dendro:slot",
  "layout": { "flow": "column", "gap": "md", "capacity": "many" },
  "collection": {
    "source": "ideas.feed",
    "key": "id",
    "templates": {
      "item": {},
      "pinned": {},
    },
    "select": "template",
  },
}
```

- `source`：数据源 id；`key`：条目身份字段。
- `templates`：具名模板集合，每个模板是一棵**不挂载**的 Slot 子树。
- `select`：条目数据里哪个字段选模板；闭集查表，不是表达式。

## 3. 模板与作用域

- 模板内部用**相对绑定**：`item.title` 表示当前条目作用域的字段。
- 模板里的节点 id 是模板内 id；实例化时由引擎派生为 `slotId#key/...`，全局唯一。
- 模板目录只做查表，不做嵌套求值；模板可以引用其他具名模板，但不允许递归。

## 4. 实例 id 与 keyed reconcile

- 条目根实例 id = `slotId#itemKey`；子节点 id 由模板 id + key 派生。
- 同 key 在更新前后是**同一个实例**，局部状态保留。
- reconcile 规则：

| 数据变化           | 动作                     |
| ------------------ | ------------------------ |
| 新 key             | 用模板实例化并挂载       |
| 已有 key、字段变化 | 更新绑定值               |
| key 消失           | unmount 实例             |
| 顺序变化           | move 实例                |
| 模板名变化         | 卸载旧实例、按新模板重建 |

## 5. 数据载荷

全量：

```jsonc
{
  "op": "data",
  "source": "ideas.feed",
  "revision": 5,
  "items": [{ "id": "42", "template": "item", "title": "…" }],
}
```

增量：

```jsonc
{
  "op": "data",
  "source": "ideas.feed",
  "revision": 6,
  "changes": [
    { "kind": "insert", "key": "43", "at": 0, "item": { "id": "43", "template": "item" } },
    { "kind": "update", "key": "42", "item": { "id": "42", "title": "…" } },
    { "kind": "remove", "key": "7" },
    { "kind": "move", "key": "42", "at": 2 },
  ],
}
```

- 同 revision 重复到达幂等；key 在增量里必须稳定。
- 全量永远可作为增量对不上的兜底。

## 6. 校验与失败隔离

- 条目 schema 不匹配、模板名不存在、key 缺失：只丢这一条，记 `E-TEMPLATE`，列表其余照常。
- 一条坏条目不能让整个根树失效；坏条目在下一次合法数据到达时恢复。

## 7. 边界

- 数据**不能凭空造任意结构**，只能实例化树里已声明的模板。
- 改模板 = 局部树更新，不是数据更新。
- 异构到模板表达不了的条目：用多个模板，或退回局部树更新。

## 8. 未定

- 模板内是否允许嵌套集合（先不做，避免递归复杂度）；
- 条目级错误在界面上的呈现；
- 大数据量下的窗口化（只实例化可见条目）是否属于引擎能力。

# 契约：Slot

> 状态：**已定未实现**。本文定义 Dendrolink 唯一的节点原语；代码当前仍是 v1 的 `{type, props, children}`。
> 依赖：[README](README.md) · [ADR-0001](decisions/0001-name.md)
> 相关：[addressing.md](addressing.md) · [structure.md](structure.md) · [rules.md](rules.md) · [composition.md](composition.md)

## 0. 一句话

Slot 是 Dendrolink 唯一的节点类型：一个带稳定 id、布局规则、数据输入、反应规则与权限的界面单元。窗口、页面、层、布局容器、按钮、卡片全是 Slot，只是 `kind` 不同。

## 1. 信封

所有节点共用一个信封，没有第二种节点。

| 块        | 字段        | 必填     | 说明                                                            |
| --------- | ----------- | -------- | --------------------------------------------------------------- |
| 身份      | `id`        | 是       | 全局唯一、跨更新/换页稳定；寻址主键                             |
| 归属      | `owner`     | 是       | 提供这棵局部树的来源；事件归属与生命周期                        |
| 作用域    | `scope`     | 否       | 数据/动作/局部状态的命名空间                                    |
| 外观/行为 | `kind`      | 是       | `dendro:slot` / `dendro:page` / `ideas:card` / `omora:button`…… |
| 排布      | `layout`    | 容器必填 | `flow / size / gap / align / scroll / capacity`                 |
| 静态数据  | `props`     | 否       | 由 kind 的 schema 校验；不放回调、key、布局                     |
| 结构      | `children`  | 否       | 默认端口下的子 Slot                                             |
| 输入      | `in`        | 否       | 消费哪些数据源/路径                                             |
| 规则      | `reactions` | 否       | 事件/数据/生命周期/路由 → 效果                                  |
| 状态      | `state`     | 否       | 渲染端持有的局部状态声明                                        |
| 权限      | `grant`     | 否       | 能力 × 主体，见 [permissions.md](permissions.md)                |

叶子节点就是 `capacity: none` 的 Slot；布局容器是带 `layout` 的 Slot；层是根部 `flow: stack` 的 Slot；页面是带路由语义、`capacity: one` 的 Slot。**节点类型只有一种，区别全在 kind 与 layout。**

## 2. kind 与 schema

- kind 是 `命名空间:名字`：引擎内置用 `dendro:*`，宿主/领域来源用 `ideas:*` 这种前缀。
- 每个 kind 声明：类别（文档 / 容器 / 叶子 / 行为）、是否允许 layout、props schema、事件名、可挂端口、是否允许 collection。
- schema 单一来源【建议】：以 Python 词表为源导出 TS 类型、校验器、文档与键索引，两端不再手写两份。
- 未知 kind 只把该节点降级成占位并记诊断，不连累兄弟；未知 props 字段按严格模式拒绝或忽略，由 schema 决定。
- 契约版本写在文档信封上：`dendro.ui/2`；版本与兼容规则在 wire 文档（待写）。

## 3. 只有三种写操作

| 操作 | 改什么                           | 载体            |
| ---- | -------------------------------- | --------------- |
| 位置 | mount / move / unmount           | slot id + order |
| 排布 | `layout` 字段                    | slot 自身       |
| 内容 | `props / in / state / reactions` | slot 自身       |

事件、数据、路由、生命周期都只是触发这三种写操作的输入，没有第四种写操作。

## 4. 最小示例

```jsonc
{
  "id": "ideas.main.feed",
  "kind": "dendro:slot",
  "owner": "ideas",
  "layout": { "flow": "column", "gap": "md", "capacity": "many" },
  "in": [{ "source": "ideas.feed" }],
  "collection": {
    "source": "ideas.feed",
    "key": "id",
    "templates": { "item": {} },
    "select": "template",
  },
}
```

## 5. 决策与未定

- 【决定】唯一原语；结构与规则平级；只有三种写操作。
- 【建议】schema 由 Python 单一来源生成；未知 kind 局部降级。
- 【未定】样式/token 是否允许进 props（当前建议只走语义变体，不传 CSS）；a11y 字段的归属。

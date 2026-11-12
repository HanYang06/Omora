# 组件：词表、schema 与扩展

> 状态：**已定未实现**；schema 生成方式是【建议】。
> 依赖：[contract.md](contract.md)
> 相关：[structure.md](structure.md) · [collection.md](collection.md) · [wire.md](wire.md)

## 0. 一句话

组件 = 带 `kind` 的 Slot；组件词表由 **schema 单一来源**生成，加一个组件不该改引擎内部。

## 1. 分类

| 类别 | 例子                                           | 特点                  |
| ---- | ---------------------------------------------- | --------------------- |
| 文档 | `dendro:window` / `dendro:page`                | 结构根、路由语义      |
| 容器 | `dendro:slot` / `dendro:layer`                 | 带 layout，可装子节点 |
| 叶子 | `dendro:text` / `dendro:button` / `ideas:card` | `capacity: none`      |
| 行为 | `dendro:hotkey` / `dendro:waveform`            | 无布局或只挂副作用    |

## 2. schema 单一来源【建议】

每个 kind 声明：

- `name`（命名空间 + 名字）、`category`；
- `props`：字段名、类型、默认值、是否必填；
- `events`：允许的事件名与载荷 schema；
- `ports`：可挂端口与容量；
- `layout`：是否允许、允许哪些字段；
- `collection`：是否允许集合绑定；
- `a11y` / `style`：语义变体与可访问性字段（不传 CSS）。

以 Python 词表为源导出 JSON schema，再生成：

| 产物             | 消费者               |
| ---------------- | -------------------- |
| TS 类型 / 校验器 | Renderer、编译期检查 |
| Python 构造器    | 来源作者             |
| 文档表           | docs/engine          |
| 键/slot id 常量  | 作者、编辑器扩展     |

## 3. Authoring API ≠ wire 形态

Python 侧可以保留好用的构造器（`Row / Column / Split` 等），它们编译成规范的 Slot + layout；线上只有一种规范形态。作者手感与契约形状解耦。

## 4. 当前 v1 词表

v1 有 38 个 kind，分两处手写：`app/sdk/omora/sdk/ui.py`、`controls.py` 与 `app/ui-engine/src/render/components.tsx`。目标是把它们收成一份 schema 后自动生成；迁移期先保留现状，新增组件必须回答“schema 在哪、另一侧怎么生成”。

## 5. 事件与数据契约

- 事件名来自闭集；载荷用类型（v1 已有 `sdk/events.py`）。
- 数据输入用 `in` / `collection` 声明，不靠组件自己取。
- 组件不持有真相，不直接调服务。

## 6. 样式与可访问性

- 只接语义变体与 token（面 / 间距 / 圆角 / 字级），不接 CSS。
- a11y 字段（role / label / description）进 props schema，渲染器负责落到 DOM。
- 图标等图形数据由节点自带（path），引擎只保留默认词表。

## 7. 扩展路径

1. **编译期宿主组件**：随宿主构建，走同一套 schema 与注册表；不需要改引擎源码。
2. **运行后来源**：等信任模型与 TS 宿主定了再开；本阶段不承诺。

## 8. 未定

- schema 描述语言（Python 元数据 / 独立 JSON / TS）；
- 组件版本与兼容（同一 kind 跨版本改 props 的规则）；
- 复合组件的局部状态暴露边界。

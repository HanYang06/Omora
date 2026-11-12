# 结构：窗口、页面、层、布局

> 状态：**已定未实现**；layout 字段表是【建议】。S3-c 已落会话层的 pages/active 与 route 意图（active 切换）；渲染层按 id 的保留/移动/替换/取消协调仍未接。
> 依赖：[contract.md](contract.md) · [addressing.md](addressing.md)
> 相关：[rules.md](rules.md) · [updates.md](updates.md) · `runtime.md`（待写）

## 0. 一句话

窗口、区域、页面、层、布局容器都是 Slot；页面切换 = 按 id 协调两棵子树，而不是整页重来。

## 1. 全是 Slot

| 概念     | kind                   | 说明                           |
| -------- | ---------------------- | ------------------------------ |
| 窗口     | `dendro:window`        | 根节点；声明区域               |
| 区域     | `dendro:slot`          | 例如导航栏、主区               |
| 页面     | `dendro:page`          | 带路由语义；`capacity: one`    |
| 层       | `dendro:layer`         | 根部 `flow: stack` 下的子 Slot |
| 布局容器 | `dendro:slot` + layout | 三栏、分栏等由 layout 表达     |

## 2. 页面：侧表 + 活动页

- `pages` 是侧表：id / label / icon / route / owner，供导航与路由使用。
- **只有当前页的子树在树里**：活动页挂到 `dendro.window.page`；未激活页不物化。
- 页面节点本身可被贡献/替换，但必须满足 `grant` 与 `capacity`。

## 3. 层：layer stack

- 根部一个 `flow: stack` 的 Slot 作为层栈；每个层是它的子 Slot。
- z 序 = 层在栈里的顺序；层内子节点再按 `order` 排。
- 嵌套的 stack Slot 形成局部层叠上下文：弹层挂最近的 layer 祖先。
- 弹层/提示挂到指定 layer，不需要改引擎代码。

## 4. 布局描述符

进格式的只有这些：

| 字段       | 取值                                | 说明               |
| ---------- | ----------------------------------- | ------------------ |
| `flow`     | `column / row / stack / none`       | 子节点排列方向     |
| `size`     | width/height/min/max，`fill` 或数值 | 尺寸约束           |
| `gap`      | 间距 token                          | 语义间距，不传 CSS |
| `align`    | `start / center / stretch`          | 对齐               |
| `scroll`   | `none / x / y`                      | 滚动归属           |
| `capacity` | `none / one / many`                 | 能装几个子节点     |

**边界**：拖拽分割、吸顶、动画、溢出策略留在组件实现里。格式不碰 CSS，也不做布局表达式。

## 5. 页面切换 = 按 id 协调

换页是 `dendro.window.page` 的子树替换 + 一条 `route` 意图。协调按 id：

| 新树里的情况     | 动作 | 生命周期                           |
| ---------------- | ---- | ---------------------------------- |
| 同 id、同槽位    | 保留 | 不重建，局部状态保留               |
| 同 id、换槽位/父 | 移动 | 实例保留，索引更新                 |
| 同槽位、不同 id  | 替换 | 旧子树卸载，新子树挂载             |
| 只在旧树         | 取消 | 撤订阅、停媒体、清局部状态、跑清理 |
| 只在新树         | 新增 | 挂载、订阅、取数据                 |

## 6. 路由

- 简单路由（进/退/切换）由 runtime 按声明执行，目标树优先用本地骨架；
- 复杂条件（涉及领域判断、权限、数据是否存在）由宿主/Python 决定并下发新树；
- 两边最后都收敛到“拿到目标树 → 按 id 协调”，执行路径只有一条。
- 路由声明与历史的细节在 updates.md / runtime.md 展开。
- S3-c 已落：`SessionState` 持有 `pages` / `active`，route op 校验目标页存在后改 active；渲染层按 id 协调（保留/移动/替换/取消）和页面历史仍未接。

## 7. 示例

```jsonc
{
  "id": "dendro.window",
  "kind": "dendro:window",
  "layout": { "flow": "row" },
  "children": [
    {
      "id": "dendro.window.nav",
      "kind": "dendro:slot",
      "layout": { "flow": "column", "size": { "width": 56 } },
    },
    {
      "id": "dendro.window.page",
      "kind": "dendro:slot",
      "layout": { "size": { "width": "fill" } },
      "capacity": "one",
    },
  ],
}
```

## 8. 未定

- 多窗口 / 多文档；
- 页面历史、深链与恢复；
- 层内焦点陷阱与可访问性语义。

# V1 运行时：DOM 宿主与组件适配

> 状态：**现状**（2026-11-20）。V1 树是默认入口；`ui.tree` 首帧、`ui.tree_event`
> 事件、`ui.changed` 异步变化都已接主会话，`?engine=tree` 预览消费 `dist/tree`。
> 相关：[构建](build.md) · [V1 树](../planning/v1-tree.md) · [renderer.md](renderer.md) · [wire](wire.md)

## 0. 一句话

V1 换的是**协调层**，不是组件：DOM 组件（`Kind`）一行不改，Slot 的 `DomRenderer` 不再参与，
由 `TreeRuntime` 按 id 建 / 更新 / 卸节点。

## 1. 分层

```text
TreeRuntime（engine/tree）
  按 id / chain / order 建树、复用、回滚；不知道 DOM
  ↓ TreeHost / NodeRenderer
DomTreeHost（app/tree/tree_host.ts）
  mount / update / unmount → 元素插入、重排、摘除
  ↓
app/tree/tree_renderer.ts
  V1 节点 → legacy Node 形状 → Kind.create / update / destroy
  ↓
components/*（现有 38 个 kind，不改）
```

- `treeKinds`（`components/tree_kinds.ts`）是唯一的 kind 词表：legacy 注册表 + `app` + `page-link`。
  构建期的 kind 存在性检查与这里的适配器共用它。
- 适配器放在 `app/tree/`：它同时依赖 engine（`TreeRuntime`）与 components（`Kind`），
  只有 `app/` 这个组合根允许跨这两层；`renderer/` 按分层规则只依赖 contract。
- 每个节点一个渲染器实例；`mount` 时建元素并给出子挂载点，`update` 原地改，
  `unmount` 只清自己（子节点由 runtime 先卸）。

## 2. 形状搬运

| V1 节点              | legacy Node     | 说明                                                                                          |
| -------------------- | --------------- | --------------------------------------------------------------------------------------------- |
| `kind`               | `type`          | 裸名字，与组件注册表同键                                                                      |
| `settings`           | `props`         | 组件不透明                                                                                    |
| `on`                 | `events`        | 只收字符串 handler id                                                                         |
| `layout`             | （不搬）        | 子节点由 runtime 挂；tabs / search 这类读子节点数据的 kind 拿浅搬的直接子节点                 |
| `slot`               | 内联样式        | `size.width/height` → width / height（数字 px，`fill` → 100%），`align` → align-self          |
| `collection.virtual` | `props.items`   | 不实例化条目；把 `data[source].items` 投影给 kind（窗口化用）                                 |
| `i18n`               | props（解析后） | prop → message key；从 `document.messages` 解析，缺 key 保留原值                              |
| `a11y`               | （不搬）        | `role` / `label` / `description` → `role` / `aria-label` / `aria-description`，覆盖组件默认值 |

**没有 Slot 的 `layout`（flow / gap / scroll / capacity）**：V1 里布局由 kind 表达
（`column` / `row` / `list`…），placement 只管尺寸与对齐。这是两套格式的语义差，不是遗漏。

## 3. 子挂载点

`Kind.childrenHosts` 返回的挂载点可以是多个（tabs 的面板、rail 的列表）。`DomTreeHost`
按下标映射到对应宿主，越界回退最后一个；`replaceHosts` 只允许在末尾追加（tabs 长出新面板），
旧下标的元素必须是同一个——换掉会让已挂的子节点丢，直接抛错。

## 4. 已验证

- `app/tree/tree_host.test.ts`：排序、更新重排、卸载、越界回退、挂载点稳定性。
- `app/tree/tree_renderer.test.ts`：结构挂载、未知 kind 失败、placement、事件回传、
  replace 复用同一元素、unmount 清空。
- `app/tree/tree_document.test.ts`：真实 ideas 空态（`static-tree.json` → compose）挂出
  app / 4 条导航 / 页面文案。
- `engine/tree/runtime_ops.test.ts`：`applyOps` 的 `setProps` 只更新目标元素；`mount / unmount`
  只动目标子树、兄弟元素引用不变；`replace` 换子树；版本不一致 / 目标缺失整批拒绝。

## 5. 入口与还没接的

- **默认入口**（`tree-live`）已切：连接 → 上报设备 → `ui.tree` 拉首帧 → compose 挂载；
  事件走 `ui.tree_event`（ops 就地 patch / 整树 replace）；异步变化订阅 `ui.changed`；
  replace 前后保留焦点与滚动位置。
- `?engine=tree` 预览：读 `/tree/manifest.json` + 页面文档 → `mountTreeDocument`；
  dev 由 `build/vite-tree-dev.ts` 供文件，`vite preview` / 部署读 `dist/tree/`。
- `?engine=virtual` / `?engine=dialog` 是组件预览，不连 Python。
- 导航从 `settings.route` 出发的跳转还没接：静态产物没有 handler，导航在预览里是禁用态。
- 事件产线只发 `setProps / mount / unmount`，表达不了回整树；Python 侧没有脏节点产线
  （[ADR-0005](decisions/0005-data-collection-before-dirty-nodes.md) 后置）。
- `data` 文档层已接（写 `document.data`、revision 幂等 / 过期诊断），运行时按 source
  定向 reconcile keyed collection：内容没变的实例一个 DOM 调用都不发，变化的那条只碰
  自己的实例子树（含模板里的嵌套节点）；集合实例的事件 payload 带 `item`（实例 key）。
- 重排步长：`host.reorder` 批量提交，宿主用 LIS 只移动必要元素；末条置顶 1 次
  `insertBefore`、头部插入 0 次移动、删除 0 次移动。
- 还没接：`changes` 增量（整批 `E-PAYLOAD`）、嵌套集合、窗口化；挂载期与整树 replace 仍是
  逐节点 `host.update`（同一类剩余整列提交）。
- 权限 / 审计 / 树内规则未接。

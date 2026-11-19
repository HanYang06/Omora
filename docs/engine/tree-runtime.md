# V1 运行时：DOM 宿主与组件适配

> 状态：**已落**（2026-11-18）。V1 文档能在 DOM 里挂载、替换、卸载；组件层不重写。
> 运行时还没接默认入口，`dist/tree` 也还没被 app 消费。
> 相关：[构建](build.md) · [V1 树](../planning/v1-tree.md) · [renderer.md](renderer.md)

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

| V1 节点    | legacy Node | 说明                                                                                 |
| ---------- | ----------- | ------------------------------------------------------------------------------------ |
| `kind`     | `type`      | 裸名字，与组件注册表同键                                                             |
| `settings` | `props`     | 组件不透明                                                                           |
| `on`       | `events`    | 只收字符串 handler id                                                                |
| `layout`   | （不搬）    | 子节点由 runtime 挂；tabs / search 这类读子节点数据的 kind 拿浅搬的直接子节点        |
| `slot`     | 内联样式    | `size.width/height` → width / height（数字 px，`fill` → 100%），`align` → align-self |

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

## 5. 预览与还没接的

- `?engine=tree` 已接：读 `/tree/manifest.json` + 页面文档 → `mountTreeDocument`；
  dev 由 `build/vite-tree-dev.ts` 供文件，`vite preview` / 部署读 `dist/tree/`。
  入口在 `app/tree/preview.ts`，失败会把原因写在页面上。
- 默认入口还没切（仍走 Slot 主会话）。
- 导航从 `settings.route` 出发的跳转没接：静态产物没有 handler，导航是禁用态。
- `collection` 实例化、`bind` 投影、`data` 的 `changes` 增量未接。
- `setProps / mount / unmount / replace` 已接（只动目标子树）；
  `data` 文档层已接（写 `document.data`、revision 幂等 / 过期诊断），运行时没有要 patch 的节点。

# 线上形状：V1 树、ops 与异步变化

> 状态：**现状**（2026-11-20）。V1 树（`dendro.tree/1`）是唯一文档格式；
> 线上只有三种 payload：`tree`（全量构建输入）、`ops`（差分更新）、
> `ui.changed` 推送（ops 或整树）。帧 / 传输 / 订阅仍归
> [协议设计](../design/protocol.md)；运行时语义见 [runtime-semantics](runtime-semantics.md) §4。
> 相关：[tree-ops.md](tree-ops.md) · [tree-runtime.md](tree-runtime.md) · [build.md](build.md)

## 0. 范围

本文只写引擎 payload 的形状与调用方式，不定义新帧类型。连接层仍是
`call / result / error / event` 四种帧（net 插件实现）；内核不解析。

## 1. 全量：`ui.tree`

首帧、重连、切页、版本对不上时，客户端拉一页的构建输入：

```jsonc
{
  "kind": "tree",
  "name": "ideas",
  "title": "灵感",
  "route": "/ideas",
  "base": {
    "schema": "dendro.tree/1",
    "version": 1,
    "root": {/* node */},
    "pages": [],
    "active": "",
    "data": {},
  },
  "partials": [
    {
      "schema": "dendro.tree/1",
      "source": "ui",
      "mount": { "parent": "…", "mode": "new" },
      "root": {/* node */},
    },
    {
      "schema": "dendro.tree/1",
      "source": "ideas",
      "mount": { "parent": "…", "mode": "new" },
      "root": {/* node */},
    },
  ],
}
```

- `base` 是这一页的骨架（`app` 根 + 导航 / 主区 + 页面容器 + 页面侧表），
  `partials` 是导航条目与页面内容局部树；形状与构建期 `build_page` 完全同构。
- 客户端用 `link/tree_compose.composeTree(base, partials)` 得到唯一文档后挂载；
  冲突 / chain 错是 `E-* ` 诊断，不产出半棵树。
- 同一份输入也由 `scripts/static_tree.py` 在构建期产出（`dist/tree/`），
  `?engine=tree` 预览消费的是构建产物；默认主会话消费 Python 的 `ui.tree`。

## 2. 差分：`ui.tree_event` → ops

用户事件的回包有两种：

```jsonc
{
  "kind": "ops",
  "document": 2,
  "base": 1,
  "seq": 1,
  "ops": [
    { "op": "setProps", "id": "…", "props": { "text": "新入口" } },
    { "op": "mount", "parent": "…", "node": {/* node */} },
    { "op": "unmount", "id": "…" },
  ],
}
```

- **当前产线只发 `setProps` / `mount` / `unmount`**：`setProps` 浅合并 `settings`，
  `mount` 按父 id 插子树，`unmount` 摘子树。ops 按声明序应用，`document = base + 1`。
- **差分表达不了就回整树**：结构字段、`order`、同级相对顺序变化时，
  `kind:"tree"` 走 `ui.tree` 同一形状，客户端整棵替换。客户端必须同时处理两种回包。
- `replace` / `data` 两种 op 的形状与应用端已实现（见 [tree-ops.md](tree-ops.md)），
  但 Python 的 `tree_event` 目前不产它们；不要按“已在线”写。

## 3. 异步变化：`ui.changed`

`set_page` / `refresh_page` 之后，如果改的是当前页，Python 通过 event 帧推
`topic = "ui.changed"`：

- payload 与 §2 完全同形：能差分就是 `kind:"ops"`，表达不了就是 `kind:"tree"`；
- 客户端与事件回包共用一条串行队列，ops 就地 patch、整树替换；
- 首帧 / 重连仍走 `ui.tree`，推送不承担全量职责。

## 4. 事件回传

渲染层把节点的 `on` 映射成 handler id（不透明字符串）。点击后客户端调：

```jsonc
{ "handler": "tree:<nodeId>:click", "payload": {} }
```

目标方法是 `ui.tree_event`。未知 handler → 宿主回失败诊断（`LookupError`），不静默；
上一代 handler 留一次宽限（组件卸载时排队的提交不能丢）。

## 5. 诊断与失败

- Python 侧诊断：`{code, path, source?, message}`，形状错误、组合失败、未知 handler、
  过期 data revision 都带现场。
- TS 侧：文档形状 / compose 冲突在挂载前拒绝；ops 形状 `E-PAYLOAD`、版本 `E-VERSION`、
  目标缺失 / chain / order 错误整批不生效；运行时 patch 失败整批回滚，保留旧树。
- 诊断不使连接断开，也不让旧树失效；客户端保留最后一份合法文档。

## 6. 跨语言契约

- V1 文档形状：`schema/tree/tree.schema.json`（Python `sdk/tree.py`、TS `contract/tree.ts`
  共用；正负例在 `schema/tree/example` / `invalid`）。
- ops 形状：`app/sdk/tests/fixtures/tree-ops.json`；Python `sdk/tree_ops.py` 与
  TS `engine/tree/ops.ts` 必须接受同一份 fixture。
- 树构建输入：构建期 `build_page` 与运行期 `ui.tree` 同形，由
  `tests/build/tree/compose.test.ts`、`tests/app/tree/tree_document.test.ts` 钉住。

## 7. 与帧集合的关系

[runtime-semantics](runtime-semantics.md) §4 用 `document / ops / dispatch / diagnostics`
描述“引擎语义上的四种东西”。当前线上没有单独的 `document` / `dispatch` 帧：
全量是 `ui.tree` 的 result，ops 是 `ui.tree_event` 的 result 或 `ui.changed` 的 event，
事件回传是一次普通 call，诊断随 result / event / error 回来。传输与订阅由 net 插件负责。

## 8. 未定

- Python 侧 `data` op 产线（document.data 与集合实例）什么时候接；
- 页面参数 / route op（当前换页 = 拉另一页的 `ui.tree`）；
- 重连增量日志 / 追赶（当前直接拉全量）；
- 多客户端会话标识是否进帧。

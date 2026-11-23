# 运行时语义：数据、行为、权限、协议、持久化、失败

> 状态：**现状**（2026-11-20）。V1 是唯一文档格式与默认入口，Slot 文档运行时已删除；
> `rules.md` / `permissions.md` 是 Slot 时期的历史设计。V1 的运行时以本文为准，
> 实现按 [TODO](../todo.md) 逐项落。
> 相关：[V1 树](../planning/v1-tree.md) · [V1 运行时](tree-runtime.md) · [V1 ops](tree-ops.md) · [构建](build.md)

## 0. 一条主线

- **文档是唯一真值**：数据、绑定、权限、审计都是它的派生或元数据。
- **所有变化走同一条管线**：

```text
来源 → ops（base, seq）→ applyOps → changed → 运行时 patch → DOM
                         ↘ 拒绝 / 失败 → diagnostics；差分表达不了 → 整树（tree）兜底
```

- 当前实现里，来源改完状态后重交页面树，再与上一棵文档差分；发出去的只是 ops。
  列表条目不再是页面节点：它们走 `data` op 与 keyed collection，页面树的重交与条目数无关。
  “脏节点产线”仍是 TODO（ADR-0005 后置），不是已实现。
- **版本由来源 / 宿主顺序分配**：每个 ops 批量带 `base` / `document` / `seq`。
- 全量 `kind:"tree"` 用于首次加载、重连、切页，以及差分表达不了时的整树兜底。

## 1. 数据权威

```jsonc
"data": {
  "ideas.feed": { "revision": 6, "items": [{ "id": "43", "template": "item", "title": "…" }] },
  "net.status":  { "revision": 1, "value": { "connected": true } }
}
```

- 一个 source 只有一种形态：`value`（标量 / 对象）或 `items`（集合），不混用。
- **只有 `data` op 能写**；source 归声明它的来源所有（见 §3）。引擎是唯一写入者。
- `revision` 单调：相等 = 幂等 no-op；更小 = 过期，忽略并记诊断；宿主记住每个 source 的当前 revision。
- 生命周期：V1 **不做自动 GC**。数据先到、视图后到是正常顺序；要撤 source 就走全量文档重载。
- 绑定：`bind` 的路径是 `<source>[.<path>]`；集合模板内是 `item.<field>`。
  `collection.source` 直接对应 `data[source].items`。
- 集合实例由运行时按 `source + key + template` 派生，**不进文档**；条目变化只走 `data` op。
- 现状：TS 有 `data` op 的**文档层**（revision 幂等 / 过期诊断）与集合原语；
  Python 产线还没发 `data` op，`bind` / `changes` / 集合消费未接（见 [TODO](../todo.md)）。

## 2. 行为模型

- `on` 是唯一的行为绑定：事件名 → handler id（来源注册的不透明字符串）。
- 事件走 `dispatch` 帧：`{kind:"dispatch", node, event, handler, payload, base}`；
  宿主路由给来源，来源回一个 ops 批（0..n 条），宿主校验 `base` 后应用。
- **V1 不执行树内规则**：没有 `reactions`；`emit` 字段保留但未使用；
  When / Bind / 页面 state 都在来源侧，文档只带已解析的结构。
- handler 的生命周期跟来源：注销后再收到就是未知 handler → 诊断，不静默。
- 动作可以异步；宿主串行化响应；`base` 过期就拒，回全量。
- 规则闭集（v2 预留，不在 V1）：触发 `event / data / lifecycle / route`；效果
  `update / mount / unmount / replace / navigate / dispatch / emit`；规则是数据，不是程序。

## 3. 所有权 / 权限的边界

- **结构所有权是树的事实**：父持有子，树本身就说清了“谁是谁的爹”。引擎不需要额外字段
  或账本；渲染与更新只认结构。
- **来源归属是宿主事实**：哪个连接 / 来源挂了哪个节点，宿主在收 ops 时自己记；
  引擎不维护 owner，也不问“这个节点是谁的”。
- **权限是宿主策略**：能力表、默认分层、跨来源规则、grant、审计口径，全在宿主；
  引擎不认识 `read / mount / update …` 这些能力名，也不解释 `settings.open`。
- 引擎只做一件事：结构操作前调用宿主注入的 `guard(op, context)`；拒绝 → 整批不生效，
  诊断原样透传。
- 请求者身份属于连接 / 会话：由 net 插件识别，宿主附到 guard 上；**不进 ops payload**。
- 树格式不携带权限：`/1` 没有 `grant`、没有 `open` 字段；文档 `ledger` 是可选来源元数据，
  引擎不解释。
- `E-PERMISSION` 是宿主诊断码，引擎只透传。
- 这不是安全边界：进程内来源可以绕过引擎 API；真正的隔离要等进程化 / 沙箱。

## 4. 协议

语义上是四种东西（线上由 `call / result / error / event` 承载，见 [wire](wire.md)）：

| 帧            | 方向                 | 用途                                                           |
| ------------- | -------------------- | -------------------------------------------------------------- |
| `document`    | 宿主 → 客户端        | 全量：当前实现是 `ui.tree` 返回 `kind:"tree"`（base + 局部树） |
| `ops`         | 来源 → 宿主          | 差分变化；`data` 是其中一种 op，不单独成帧                     |
| `dispatch`    | 客户端 → 来源        | 事件回传（handler + payload）                                  |
| `diagnostics` | 宿主 → 来源 / 客户端 | 拒绝、失败、告警；带 `code / path / source`                    |

- **版本权在宿主**：来源带 `base`；不匹配 → 宿主回 `document`，来源基于新版本重来。
- `seq` 每个来源单调；同一 `(source, seq)` 重复到达是 no-op。
- 重连：`hello{version}` → 宿主回 `document`；V1 没有增量日志。
- 换页：V1 = 换一份 `document`（产物本就按页拆）；route op 留到需要时再加。
- 传输不归引擎：net 插件负责收发 / 订阅 / 重连；引擎只认形状。

## 5. 持久化

- 引擎**不持久化文档**：durable 数据归 store，文档版本只在运行时有效。
- 唯一的“快照”是构建产物（`dist/tree/` + manifest）；默认主会话不读它，从 Python 拉 `ui.tree`。
- schema：`/1` 内加可选字段不破坏；破坏性改动 → `/2` + `migrateDocument`；
  未知 schema → 诊断 + 全量重载。
- 重连快照 = 来源重新交全量文档；V1 不做引擎侧 journal / cache。
- 迁移 runner 是 0.2 的事（store 字段），不在引擎。

## 6. 失败

- **批次失败**：文档与 DOM 都不变，回诊断；来源拿新 `base` 重试。
- **条目坏**（collection）：只丢该条 + `E-TEMPLATE`，列表其余继续。
- **渲染失败**：整批回滚（原子），不留半棵树。
- **版本 / seq 不匹配**：拒 + 回 `document`，不猜顺序。
- **未知 kind**：构建期失败；运行时 `E-TREE-KIND` 直接挂载失败，不画占位。
- **诊断形状**：`{code, path, source?, message}`；日志 + 状态栏，不静默空白。
- **重试幂等**：同一 `(source, seq)` / 同一 `revision` 重复应用是 no-op。

## 7. 决策清单

| 维度     | 决定                                                          |
| -------- | ------------------------------------------------------------- |
| 数据形态 | `data[source] = {revision, value \| items}`；集合实例不进文档 |
| 写入权   | 只有 `data` op；source owner 发布，宿主唯一写入               |
| 幂等     | revision 相等 no-op、更小忽略；`(source, seq)` 重复 no-op     |
| 行为     | `on` → dispatch → 来源回 ops；V1 不做树内规则                 |
| 权限     | 引擎不判定；结构只给父子，来源归属与策略在宿主（guard 注入）  |
| 兼容     | 规则留给 `/2`；权限不进格式，`/1` 不加字段                    |
| 协议     | `document / ops / dispatch / diagnostics`；data 是 op         |
| 版本     | 宿主唯一分配；不匹配回全量                                    |
| 持久化   | 引擎不落盘；快照 = 构建产物；迁移走 `/2`                      |
| 失败     | 批次原子失败；条目级隔离；诊断不静默                          |

## 8. 与旧文档的关系

- `rules.md` / `permissions.md`：Slot 时期的历史设计；V1 的边界以本文为准。
- `wire.md`：已改写为 V1 的 payload 形状（tree / ops / ui.changed / 事件回传）。
- `collection.md` / `updates.md`：Slot 时期的集合 / 更新设计；V1 的 data 投影见 §1，
  ops 形状见 [tree-ops](tree-ops.md)。

## 9. 未定

- 树内规则（`reactions`）的形状（`/2`）；宿主侧的能力模型 / grant；
- source 的显式移除帧（V1 用全量重载兜底）；
- 重连增量日志 / 追赶；
- 进程化后的安全边界。

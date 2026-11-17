# 运行时语义：数据、行为、权限、协议、持久化、失败

> 状态：**V1 口径已定**（2026-11-18）。`rules.md` / `permissions.md` / `wire.md` 是 Slot 时期的设计，
> V1 的运行时以本文为准；实现按 [TODO](../todo.md) 逐项落。
> 相关：[V1 树](../planning/v1-tree.md) · [V1 运行时](tree-runtime.md) · [V1 ops](tree-ops.md) · [构建](build.md)

## 0. 一条主线

- **文档是唯一真值**：数据、绑定、权限、审计都是它的派生或元数据。
- **所有变化走同一条管线**：

```text
来源 → ops（base, seq）→ 宿主 guard → applyOps → changed → 运行时 patch → DOM
                         ↘ 拒绝 / 失败 → diagnostics；版本不匹配 → document 全量
```

- **版本由宿主唯一分配**；来源只声明“我基于哪个版本”。
- 全量 `document` 只有三种用途：首次加载、重连、版本不匹配。

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

## 3. 权限模型

- **所有权按节点**：`ledger[node.id].source`；没写就继承最近祖先，根是基座来源。
- 能力：`read / mount / update / replace / remove / data / route`。
- 默认：
  - owner 对自己子树全能力；
  - 系统来源全能力；
  - 跨来源 mount 只允许目标节点 `settings.open === true`（贡献点约定）；
  - 只有 source 的 owner 能发布它的数据；
  - route 只允许切到自己拥有的页面。
- 检查点：组合（构建期）、ops（宿主 guard）、data、route。拒绝 → 整批不生效 + 审计。
- `/1` **没有 `grant` 字段**；需要委派时升 `/2` 再加。`settings.open` 是约定，不是 schema。
- 这不是安全边界：进程内来源可以绕过引擎 API；真正的隔离要等进程化 / 沙箱。

## 4. 协议

四种帧：

| 帧            | 方向                 | 用途                                                      |
| ------------- | -------------------- | --------------------------------------------------------- |
| `document`    | 宿主 → 客户端        | 全量文档（带 `page` / `version`）；加载、重连、版本不匹配 |
| `ops`         | 来源 → 宿主          | 所有变化；`data` 是其中一种 op，不单独成帧                |
| `dispatch`    | 客户端 → 来源        | 事件回传（handler + payload + base）                      |
| `diagnostics` | 宿主 → 来源 / 客户端 | 拒绝、失败、告警；带 `code / path / source`               |

- **版本权在宿主**：来源带 `base`；不匹配 → 宿主回 `document`，来源基于新版本重来。
- `seq` 每个来源单调；同一 `(source, seq)` 重复到达是 no-op。
- 重连：`hello{version}` → 宿主回 `document`；V1 没有增量日志。
- 换页：V1 = 换一份 `document`（产物本就按页拆）；route op 留到需要时再加。
- 传输不归引擎：net 插件负责收发 / 订阅 / 重连；引擎只认形状。

## 5. 持久化

- 引擎**不持久化文档**：durable 数据归 store，文档版本只在运行时有效。
- 唯一的“快照”是构建产物（`dist/tree/` + manifest）。
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
| 权限     | ledger 所有权 + 能力表；跨来源挂载要 `settings.open`          |
| 兼容     | `grant` / 规则留给 `/2`；`/1` 不加字段                        |
| 协议     | `document / ops / dispatch / diagnostics`；data 是 op         |
| 版本     | 宿主唯一分配；不匹配回全量                                    |
| 持久化   | 引擎不落盘；快照 = 构建产物；迁移走 `/2`                      |
| 失败     | 批次原子失败；条目级隔离；诊断不静默                          |

## 8. 与旧文档的关系

- `rules.md`：触发 / 效果闭集保留，作为 v2 规则设计的边界；V1 不实现树内规则。
- `permissions.md`：能力 / 主体模型保留；V1 用 ledger 所有权 + `settings.open`，`grant` 留 `/2`。
- `wire.md`：payload 形状保留作参考；V1 的帧集合以本文 §4 为准。
- `collection.md` / `updates.md`：语义一致；V1 的 data 投影见 §1。

## 9. 未定

- 树内规则（`reactions`）与 `grant` 的具体形状（`/2`）；
- source 的显式移除帧（V1 用全量重载兜底）；
- 重连增量日志 / 追赶；
- 进程化后的安全边界。

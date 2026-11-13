# 运行时：分层、生命周期与失败

> 状态：**已定未实现**；分层名称是【建议】。S3-a–e 已落文档状态/三张索引、ops、data router、绑定/session、v2 渲染桥/水合/换页分类、跨父 move 与预览；S4 已落 EngineRuntime（session + ledger + metrics + render stats）、DocumentView、权限薄层（链接期 + 运行期）、来源宿主（SourceHost + load/requesterFor）、来源模式引擎（SourceEngine）、审计与耗时指标。多客户端、来源热更新接线、v2 替换主会话仍待。
> 依赖：[contract.md](contract.md) · [composition.md](composition.md) · [updates.md](updates.md)
> 相关：[components.md](components.md) · [wire.md](wire.md) · [testing.md](testing.md)

## 0. 一句话

引擎不是一个渲染函数，而是一套运行时：合同、编译/链接、权威文档、索引、会话、渲染、来源宿主、诊断各管一段，层与层之间只有明确合同。

## 1. 分层

| 层                    | 做什么                                | 不做什么                       |
| --------------------- | ------------------------------------- | ------------------------------ |
| **Contract**          | 节点/文档形状、版本、错误码           | 依赖渲染框架、连接实现或业务词 |
| **Compiler / Linker** | 局部树 → 权威根树 + 诊断；纯函数      | 请求数据、判断业务对错         |
| **Document**          | 持有根树、三张索引、版本              | 解释节点内容                   |
| **Session**           | 每连接的快照、版本、订阅、重放        | 跨连接共享状态                 |
| **Data Router**       | 绑定/规则/集合；把数据送到该去的位置  | 持有领域真相                   |
| **Renderer**          | Slot → DOM；元素复用、错误隔离        | 改业务状态、发领域请求         |
| **Producer Host**     | 登记局部树/数据、装载与卸载、卸载账本 | 让来源绕过合同直接改引擎       |
| **Diagnostics**       | 指标、日志、调试索引、诊断面板        | 往用户界面塞技术细节           |

## 2. 数据流

```text
局部树（多个来源）
  → Compiler/Linker（类型检查 + 链接 + 诊断）
  → 权威根树 + 三张索引
  → Renderer

数据更新 → Data Router（绑定/规则/集合）→ 文档增量 → 受影响 Slot 重渲染
事件     → 规则/分发 → 位置/排布/内容三种写操作
```

根树只有一个写入口：引擎的更新管线。任何来源都只能提交请求，由引擎校验后应用。

## 3. 生命周期账本

引擎维护一份**登记 → 撤销**账本，至少覆盖：

- 订阅（topic / 数据源）；
- 媒体与设备占用；
- 事件监听；
- 局部状态；
- 某个来源占用的局部树与 slot；
- 渲染层注册的组件/监听。

卸载顺序：页面切换或来源卸载时逆序撤销；异步操作在卸载后返回不得再写状态。S4 已落原语与接线：`LifecycleLedger`（逆序、错误隔离、幂等）+ `EngineRuntime.dispose`（清监听 → 账本收口）+ `DocumentView.dispose`（监听/渲染器/引擎一起收口）。媒体、订阅等具体登记点随各 kind/宿主接线继续补。

## 4. 失败隔离

| 故障               | 处理                             |
| ------------------ | -------------------------------- |
| 未知 kind          | 该节点降级占位，兄弟继续         |
| 一份局部树编译失败 | 拒绝该来源，保留上一棵合法根树   |
| 组合成环 / 死引用  | 拒绝并记诊断，不抛到界面         |
| 补丁版本不匹配     | 请求全量，不猜                   |
| 迟到事件           | 只允许一次宽限，记指标           |
| 坏条目             | 只丢这一条，记 `E-TEMPLATE`      |
| 来源 activate 失败 | 整个来源回滚，不影响别人         |
| 卸载失败           | 记录失败项，继续撤其余，最后汇总 |

## 5. 会话与多客户端

- 每个连接一份会话：当前页、文档版本、订阅、重放状态。
- 当前实现只有单客户端假设，且版本基准是全局的；多客户端属于 S4/S5 之后。
- 会话关闭：清空订阅与运行期状态，不保留跨连接脏引用。

## 6. 观测

至少要能量出：组合/链接耗时、补丁字节与 op 数、丢弃的贡献数、未知 kind 数、迟到事件数、一次更新触发的重渲染节点数。指标进日志与开发面板，不上用户界面。

S4 已落第一版：`RuntimeMetrics`（opsBatches / opsCount / dataUpdates / fullUpdates / rejections / diagnostics / lastDiagnostics / notifications / renders / lastApplyMs / totalApplyMs / maxApplyMs + version）挂在 `EngineRuntime` 上，成功/失败都记账、每次 apply 计时；`AuditLog` 结构化记录 apply/reject/deny/diagnostic；`DocumentView` 每次渲染调 `noteRender()` 并上报 `RenderStats`（created/updated/reused/removed）到指标；`?engine=v2` 预览已改用 EngineRuntime + DocumentView（dogfood）。

## 7. v1 映射

| 现在的位置                                 | 目标层                                 |
| ------------------------------------------ | -------------------------------------- |
| `app/ui-engine/src/app.tsx`                | Session + 容器                         |
| `render/compose.ts`                        | Compiler/Linker（v1 贡献模型）         |
| `render/patch.ts` + `packages/ui/_diff.py` | Document + 更新管线（v1，待替换）      |
| `app/ui-engine/src/runtime/`               | Document / 索引 / ops / 集合 / session |
| `runtime/engine.ts` + `metrics.ts`         | EngineRuntime（会话 + 账本 + 指标）    |
| `dom/v2/view.ts`                           | DocumentView（引擎 ↔ DOM）             |
| `runtime/sources.ts`                       | Producer Host（来源注册/级联）         |
| `runtime/audit.ts`                         | 审计日志                               |
| `render/renderer.tsx` + `components.tsx`   | Renderer + 组件注册表                  |
| `packages/ui/ui.py`                        | 页面/文档注册（v1）                    |
| —                                          | Producer Host、Diagnostics（待建）     |

## 8. S4 实现（已落）

- **EngineRuntime**（`runtime/engine.ts`）：`createEngine` = createSession + hydrate；`applyOps` / `applyData` / `applyFull` / `applyLocalTrees` 成功后换会话、记指标、通知监听者，失败原子、记 rejections；`onChange` / `registerCleanup` / `dispose`（清监听 + 逆序账本，幂等）。`applyLocalTrees` = 链接全部局部树 → 替换树 → 版本 +1 → 当前 data 水合（全量更新闭环）。
- **指标**（`runtime/metrics.ts`）：计数器 + 最近诊断快照 + apply 耗时 + 渲染计数，挂在 EngineRuntime 上。
- **审计**（`runtime/audit.ts`）：有界 `AuditLog`（apply/reject/deny/diagnostic + code/owner/slot/changed）；EngineRuntime 每次 apply 记录，权限拒绝逐条 deny。
- **权限薄层**（`runtime/permissions.ts` + `link/link.ts`）：链接期挂载检查 + 运行期 ops/data 检查，越权 E-PERMISSION；默认系统来源全放行（见 [permissions.md](permissions.md) §8）。
- **来源宿主**（`runtime/sources.ts`）：owner → 局部树注册表；支持 `load` 整组替换与 `requesterFor` 权限透传；登记/移除后重新链接，死引用级联撤掉，其他失败回滚保留上一棵好树；dispose 走账本。
- **来源模式引擎**（`runtime/engine_sources.ts`）：`SourceEngine` = SourceHost + EngineRuntime 组合；`createEngineFromLocalTrees(payload)` 从 local-trees 直接建引擎；`registerSource` / `removeSource` / `applyLocalTrees` 先由 host 重算权威树，再交引擎提交版本/水合/指标/审计/通知。
- **DocumentView**（`dom/v2/view.ts`）：createEngine → 桥接根树 → DomRenderer；引擎通知后按 id 重画；`dispose` 取消监听/渲染器/账本三件套。
- **未接**：来源热更新/activate 账本与网络帧接线、订阅与媒体登记点、跨连接会话、`observe`/`intercept`、重渲染节点数指标、v2 替换主会话。

## 9. 未定

- TS 宿主与运行后来源的信任模型；
- 多客户端会话与版本隔离；
- 指标保留策略与调试面板形态。

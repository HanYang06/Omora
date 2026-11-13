# 迁移：旧实现（legacy）→ Dendrolink

> 状态：**提议**（随实现逐阶段转正）。
> 依赖：[README](README.md) · [runtime.md](runtime.md) · [wire.md](wire.md)
> 相关：[docs/planning/change-program.md](../planning/change-program.md)（仓库结构迁移，已合并）

## 0. 原则

1. 先文档、再兼容层、最后清理；每个阶段都能单独回滚。
2. 一个阶段 = 一个 PR；实现 + 测试 + 文档同 PR。
3. 代码与旧文档冲突时，以本系列“目标契约”为方向、以当前代码为现状，不把未实现写成事实。
4. 不追求一次迁移 38 个组件；先用一个真实页面把契约走通。
5. 不按版本号分层：旧实现叫 legacy（旧节点模型 / 旧快照渲染），新运行时叫 Slot 文档 / Dendrolink。

## 1. 阶段

| 阶段 | 内容                                                    | 退出条件                          |
| ---- | ------------------------------------------------------- | --------------------------------- |
| S0   | 仓库结构迁移、引擎文档系列、旧文档退役                  | 工作区干净；CI 绿；文档链接通过   |
| S1   | schema 单一来源；Python 序列化产出 Slot；跨语言 fixture | 同一 fixture 两侧结论一致         |
| S2   | 编译/链接：诊断码、顺序模型、静态骨架编译门禁           | 冲突在 CI 可复现；死引用/歧义必报 |
| S3   | 三张索引 + 三种更新 + 集合绑定；灵感页 spike            | 数据更新不重挂；换页协调正确      |
| S4   | 权限薄层 + 生命周期账本 + 观测指标                      | 越权拒绝；卸载零残留；有指标      |
| S5   | TS 宿主 / 组件命名空间 / 运行后来源                     | 示例来源不改引擎源码即可加界面    |

> S1.1 进度（2026-11-13）：已落 `app/sdk/omora/sdk/document.py`（类型）+ `document_io.py`（校验/序列化）与 `app/ui-engine/src/contract/document.ts` 的 Slot 文档契约，以及共享 fixture `app/sdk/tests/fixtures/document.json`；尚未接入运行时。

> S5 起步进度（2026-11-14）：`SourceEngine`（SourceHost + EngineRuntime 组合，createEngineFromLocalTrees / registerSource / removeSource / applyLocalTrees）与 renderer 节点统计（created/updated/reused/removed → 指标）已落。schema 已重置为 `dendro.ui/1`、legacy/Slot 术语已收口；下一步拆组件目录与分层。

> S4 续（二）进度（2026-11-13）：`EngineRuntime.applyLocalTrees`（全量局部树重链 → 替换树 → 水合 → 版本+1/指标/审计）已落；Slot 布局 size/gap/align/scroll 落到 CSS 变量与 `[data-dendro-layout]` 样式；`?engine=slot` 预览改用 EngineRuntime + DocumentView（dogfood）。来源宿主接网络帧、Slot 路径替换主会话、重渲染节点数、observe/intercept 待续。

> S4 续进度（2026-11-13）：链接期挂载权限（`link/link.ts` + base 归一化）、来源宿主 `SourceHost`（注册/级联/fail closed）、审计 `AuditLog` 与 apply 耗时/渲染计数已落。来源热更新与网络帧接线、observe/intercept、重渲染节点数、Slot 路径替换主会话待续。

> S4 进度（2026-11-13）：权限薄层（`host/permissions.ts` op 检查 + `contract/policy.ts` 纯策略，ops/data 运行期检查）、EngineRuntime（session + 生命周期账本 + 指标 + 变更通知，`host/engine.ts`/`metrics.ts`）、DocumentView（`app/view.ts`）已落。链接期权限、Producer Host/来源生命周期、订阅/媒体登记点、审计与耗时指标待续。

> S3-e 进度（2026-11-13）：DOM renderer 支持跨父 move 复用元素（`renderer.ts`，换页保留实例）；Slot 预览入口 `?engine=slot`（独立 chunk）；生命周期账本原语（S4 预落）。Slot 会话替换主入口、layout 样式、S4 权限/观测待续。

> S3-d 进度（2026-11-13）：Slot → DOM 薄桥（`src/renderer/slot_bridge.ts` + `src/app/slot_registry.ts`，`dendro:<legacy type>` 别名 + `src/components/slot_kinds.ts` 的 Slot 原生结构 kind）、会话水合（`engine/updates/hydrate.ts`）、换页分类（`engine/document/page_switch.ts`）与 fixture→DOM 集成 spike 已落。渲染结果：数据更新/全量替换不重挂；跨父 move 的 DOM 复用、Slot 路径进主入口、layout 样式待续。

> S3-c 进度（2026-11-13）：标量 `in`/`bind` 绑定（`src/engine/updates/data_bind.ts`）、会话层 Session（pages/active/data）、route op 执行与全量文档替换（`src/engine/document/session.ts`）已落；Python `update.RouteOp` + 共享 `route.json`。渲染层按 id 换页协调、页面参数、灵感页 spike 待 S3-d。

> S3-b 进度（2026-11-13）：data router 已落（`src/engine/updates/data.ts`：parseData / applyData、revision 幂等、集合全量/增量接入、changed），Python `sdk/data.py` + 共享 `data.json` 提供纯数据线上形状。标量绑定、`route`、全量文档会话、渲染接入待续。

> S3-a 进度（2026-11-13）：文档运行时核心已落 —— `app/ui-engine/src/engine/document/document.ts`（`DocumentState` + 三张索引）、`ops.ts` + `ops_apply.ts`（局部树 ops 原子应用、版本/base、changed）、`collection.ts`（模板实例化 + keyed reconcile 原语）；`sdk/update.py` + 共享 `ops.json` 提供 ops 线上形状。纯数据更新/数据路由、`route`、渲染接入、全量更新会话接线待 S3-b。

> S2 第一版进度（2026-11-13）：链接期编译器 `app/ui-engine/src/link/`（形状校验、多轮挂载、order/seq/容量/replace、六个诊断码、确定性/原子性）已落；`sdk/local_tree.py` + 共享 fixture 提供 local-trees 线上形状；`vite build` 用共享 fixture 跑构建期门禁。运行时接入、按 kind schema、权限、`before/after`、`static_ui.py` 编译门禁升级待后续。

> 渲染层迁移（ADR-0002）已落：React 已删除；38 个 kind 有 DOM 实现与 jsdom 测试；`index.html` 入口切到 `src/app/main.ts`；Vite 不再编译 React。启动骨架也已在构建期编译进 `index.html`（见 [renderer.md](renderer.md) §9）。

## 2. 兼容策略

- **legacy 加字段**：节点允许新增 `id / events / layout / reactions / collection / grant`，旧 `{type, props, children}` 仍可读；渲染器优先新字段，回退旧路径。
- **双读窗口**：S1–S3 期间新旧序列化并行，fixture 同时覆盖；S4 后删除旧路径。
- **全量兜底**：迁移期协议允许新引擎向旧客户端发全量；不做长期双协议。
- **命名空间迁移**：`omora.ui/2` / `omora:*` / `om.*` → `dendro.ui/1` / `dendro:*` / `dendro.*`；在 S1 一次性换掉，fixture 与生成物同步。

## 3. 代码迁移映射

| 现在                                      | 目标                                | 阶段                                            |
| ----------------------------------------- | ----------------------------------- | ----------------------------------------------- |
| `app/sdk/omora/sdk/ui.py` / `controls.py` | Slot 词表 + schema 源               | S1                                              |
| `packages/ui/omora/ui.py`                 | 文档/局部树注册 + 数据路由          | S2–S3                                           |
| `packages/ui/omora/_diff.py`              | 文档增量（按 id）或删除             | S3                                              |
| `app/ui-engine/src/app.tsx`               | Session + 运行时容器                | S3                                              |
| `legacy/render/compose.ts`                | legacy 贡献组合（运行时，待替换）   | S3                                              |
| `app/ui-engine/src/link/`                 | Compiler/Linker（Slot 局部树）      | S2 已落（运行时未接）                           |
| `app/ui-engine/src/engine/`               | Document / 索引 / ops / 集合        | S3-a 已落（渲染接入未做）                       |
| `legacy/render/patch.ts`                  | Document 更新管线（legacy，待替换） | S3 未接                                         |
| `renderer/` / `components/`               | Renderer + schema 生成注册表        | S1–S3 已落                                      |
| `scripts/static_ui.py`                    | 构建期编译门禁                      | 未升级（门禁暂由 `src/link` 共享 fixture 承担） |
| `scripts/keys.py` / generated             | slot id 生成器                      | S1                                              |

## 4. 旧文档去向

| 旧文档                               | 去向                                                            |
| ------------------------------------ | --------------------------------------------------------------- |
| `docs/design/ui-engine.md`           | 节点/流程并入 `runtime.md` / `components.md` / `wire.md` 后删除 |
| `docs/design/ui-plugins.md`          | 键/贡献并入 addressing/composition 后删除                       |
| `docs/design/ui-engine-subsystem.md` | 归档到 `docs/engine/archive/`（已退役）                         |
| `docs/design/ui-tree.md`（草案）     | 已拆入本系列后删除                                              |

## 5. 风险与回滚

- **协议形状变化**：S1 起新旧字段并存；回滚只需停用新字段读取。
- **组件迁移遗漏**：以 fixture + 渲染测试兜底；每迁一组组件补一组行为测试。
- **性能退化**：S3 建立与 legacy 的对照基线；组合/补丁指标进 CI 报告。
- **过渡期文档失真**：所有未实现条目保持“已定未实现”，不写成现状。

## 6. 未决

- S1 的 schema 描述语言；
- legacy 双读窗口要持续几个 PR；
- 何时允许删除旧序列化路径；
- 运行后来源与 TS 宿主是否放在同一轮。

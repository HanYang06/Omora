# Dendrolink（Dendro）· 树链引擎

> **Dendrolink：把局部树链接成权威根树的链接期引擎。**
>
> 状态：**设计已定；S0–S6 已落，S7 起步（剩余项归为非核心，按需）**；身份与根树结构文件已落：契约字段、`root-tree.json`、页面/导航局部树的 `code` / `addr` 派生、`addr` 索引、旧 addr redirect / 墓碑（表上限 256）与结构变化后的子树 addr 重算；主会话已接 props / 结构 / replace / data batch 增量（端到端 DOM stats 已钉），addr 仍不直接驱动 DOM，ops / 渲染按 `id` + Node 缓存。本文是引擎文档集的索引与总纲；主会话、构建期首帧与全部系统插件页面都走 Slot（局部树 → 链接 → EngineRuntime/DocumentView），运行后来源示例已接（自动发现 + 热更新），`?engine=slot` 只是内置 fixture 预览。剩余大项：Host 网络帧 / 订阅 / 媒体登记、规则执行（`reactions`）、schema 单一来源——都归为非核心，按需做；主线是 V1 的静态结构与最小节点更新。
> 基线：`main@3910928`（S6.5 骨架编译后），工作区干净。
> 命名决定见 [ADR-0001](decisions/0001-name.md)。

> **2026-11-18：V1 树目标架构**：`dendro.tree/1` 的契约/校验、`omora.scope/1` node scope、`omora.page/1` Page/State/When/Bind、build-time composer、runtime mount 已落地；结构层成立，最小节点 ops 与协议未接。它分阶段接管默认入口（[ADR-0004](decisions/0004-static-tree-minimal-updates.md)），目标链路见 [V1 树](../planning/v1-tree.md)。

## 1. 它是什么

Dendrolink 是一个 **UI 文档运行时**：

- **输入**：多个独立来源的**局部树**。插件只是来源之一；worker、独立进程、远程服务、AI 生成、测试 fixture 都可以走同一份契约。
- **核心**：在**链接期**把局部树组合成唯一权威的**根树**；冲突是编译错误，不是运行期猜一个顺序。
- **输出**：一份可寻址的文档。同一份文档上支持**全量 / 纯数据 / 局部树**三种更新；稳定身份让更新只碰该碰的节点。
- **行为**：结构与规则平级。事件/数据 → 反应（改内容、挂卸、路由、回源）都写在树里，引擎只执行。

它**不是组件库**，也**不是插件系统**。组件是 Slot 的 kind，插件是局部树的一种来源——两者都是外面的壳，不是引擎的本质。

## 2. 论文式定义

> 多来源应用的界面由独立编写的局部树组成，但现有运行时要么在运行期尽力合并，要么整棵快照推来推去。Dendrolink 把界面建模成一份权威的、可寻址的 Slot 文档：局部树在链接期组合，冲突是编译错误；同一份文档支持三级更新；稳定身份消除重挂与回调换代的成本。

贡献五条：

1. **唯一原语 Slot**：结构、排布、数据输入、反应规则、权限在同一个信封里。
2. **链接期组合**：局部树 + 编译/链接 + Rust 式诊断；运行期不猜顺序、不静默丢东西。
3. **三级更新**：全量 / 纯数据（含集合模板）/ 局部树，收口到同一份权威文档。
4. **全寻址 + 按 Slot 订阅**：事件与数据不靠渲染代次定位，最小重渲染成立。
5. **可测性质**：收敛、幂等、原子、身份保持、编译确定性，加真实应用迁移验证。

## 3. 命名与命名空间

| 项            | 值                                                                                       |
| ------------- | ---------------------------------------------------------------------------------------- |
| 正式名        | Dendrolink                                                                               |
| 简称 / 口头   | Dendro、树链引擎                                                                         |
| 英文标题      | Dendrolink: A Link-Time Engine for Composing Local Trees into an Authoritative Root Tree |
| 中文标题      | 《Dendrolink：把局部树链接成权威根树的链接期引擎》                                       |
| schema        | `dendro.ui/1`                                                                            |
| 引擎内置 kind | `dendro:slot` / `dendro:page` / `dendro:layer` / `dendro:window`                         |
| 宿主导入 kind | 保持 `ideas:card` 这种                                                                   |
| id 前缀       | `dendro.window` / `dendro.window.page`                                                   |
| CSS 前缀      | `dendro-`                                                                                |
| 包名          | `@dendro/runtime`（或 `dendro-runtime`）                                                 |
| 文档目录      | `docs/engine/`                                                                           |

## 4. 文档地图

本文档集按“一个概念一个家”拆；状态见下表。

| 文档                                      | 负责什么                                                                    | 状态   |
| ----------------------------------------- | --------------------------------------------------------------------------- | ------ |
| `README.md`                               | 索引、定位、命名、术语、实现状态                                            | 已写   |
| `decisions/0001-name.md`                  | 命名决定与影响                                                              | 已写   |
| `decisions/0002-no-react-dom-renderer.md` | 移除 React、渲染层直写 DOM 的决定                                           | 已接受 |
| [contract.md](contract.md)                | Slot 原语、字段、schema、版本、kind 注册                                    | 已写   |
| [addressing.md](addressing.md)            | id 规则、身份（code/chain/addr/path）、三张索引、更新集合、全寻址 vs 可介入 | 已写   |
| [structure.md](structure.md)              | window/page/layer/layout、窗口骨架结构文件、页面切换的按 id 协调            | 已写   |
| [rules.md](rules.md)                      | 触发 × 效果闭集、数据输入、规则索引                                         | 已写   |
| [collection.md](collection.md)            | 集合绑定、模板、keyed reconcile、条目实例 id                                | 已写   |
| [composition.md](composition.md)          | 局部树、编译/链接、顺序模型、诊断、root tree 归属                           | 已写   |
| [updates.md](updates.md)                  | 三种更新、事务、版本、兜底、重同步                                          | 已写   |
| [permissions.md](permissions.md)          | 能力 × 主体、默认分层、检查点、非安全边界                                   | 已写   |
| [runtime.md](runtime.md)                  | 引擎分层、生命周期账本、失败隔离、诊断面板                                  | 已写   |
| [layering.md](layering.md)                | 组件/渲染/链接/算法/宿主分层与依赖方向                                      | 已写   |
| [renderer.md](renderer.md)                | 渲染层：Kind 接口、DOM 协调、测试约定                                       | 已写   |
| [components.md](components.md)            | 组件词表、schema 单一来源、authoring API 与 wire 形态                       | 已写   |
| [wire.md](wire.md)                        | 引擎 payload 形状；帧/传输仍归 `docs/design/protocol.md`                    | 已写   |
| [testing.md](testing.md)                  | 九条不变量、fixture、编译诊断测试、集合等价测试                             | 已写   |
| [migration.md](migration.md)              | legacy→Dendrolink 迁移记录、S0–S7、旧文档去向                               | 已写   |
| [archive/](archive/)                      | 已退役的提案与旧设计                                                        | 已退役 |

旧草案（`docs/design/ui-tree.md`）已拆入本系列并删除。

## 5. 阅读顺序

1. 本文：它是什么、叫什么、文档在哪。
2. `contract.md`：一个 Slot 长什么样。
3. `addressing.md` + `structure.md`：怎么找到它、它挂在哪。
4. `rules.md` + `collection.md`：它怎么动、数据怎么进来。
5. `composition.md` + `updates.md`：局部树怎么合成权威根树、之后怎么更新。
6. `permissions.md` + `runtime.md`：谁能动它、引擎内部怎么分层。
7. `components.md` + `wire.md` + `testing.md`：怎么加组件、线上长什么样、拿什么验收。
8. `migration.md`：从 legacy 到 Dendrolink 怎么走。

## 6. 实现状态（与代码的差距）

**V1 树（`dendro.tree/1`）**：契约/校验、Python/TS node scope、Page/State/When/Bind、build composer、runtime mount 已落；构建期已把真实页面 compose 成每页产物（`dist/tree/`，见 [构建](build.md)），**更新层与协议层未落**（runtime 的 replace 仍是整份文档，主会话仍发整份 view）。V1 是目标架构，分阶段接管默认入口，见 [V1 树](../planning/v1-tree.md)。

文档写的是**契约**，不是现状说明书。S0–S6 与 S7.1 已落（含 Slot 骨架编译、legacy 删除、运行后来源示例），Python / TS 全量测试全绿。差距集中在规则执行（`reactions`）、schema 单一来源、远程来源网络接线；这些是非核心，按需做。主线是 [V1 树](../planning/v1-tree.md) 的最小节点更新与协议。

| 能力       | 现状                                                                                                                          | 缺口                                                                                                                                                                         |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 节点契约   | Slot 信封（id / owner / kind / layout / props / children / events / reactions / grant）                                       | `reactions` 只解析，执行未做                                                                                                                                                 |
| 文档契约   | `dendro.ui/1` + 跨语言 fixture + `parseDocument` 校验                                                                         | schema 单一来源（Python 词表导出 TS）未做                                                                                                                                    |
| 寻址       | 三张索引 + 全寻址；列表项可用 `id_key` 稳定                                                                                   | 路径级索引与增量维护未做（当前每步重建）；通用 `Node.key` 未做                                                                                                               |
| 身份       | Slot 可选 `code` / `addr` 契约字段；`addr = H(parent.addr, code)`，`chain` 由祖先 code 算出；页面/导航局部树已派生            | `id` + `addr` 索引、旧 addr redirect / 墓碑与 move/mount/replace 后子树 addr 重算已落；ops / 渲染仍按 `id`；集合模板 / 通用 Node key 待补                                    |
| 根树结构   | 窗口 / 导航 / 页面骨架单一来源 `app/sdk/omora/sdk/root-tree.json`（`anchors` 映射语义名 → slot id；骨架静态 `code` / `addr`） | 结构文件与加载器已落；页面/导航从锚点继续链                                                                                                                                  |
| 组合       | 链接器：形状校验 / 多轮挂载 / 顺序 / 容量 / replace / 诊断码 / 构建门禁                                                       | 按 kind 的 props/events schema、`before/after`、`E-TEMPLATE` 未做                                                                                                            |
| 更新       | 全量 / 纯数据 / 局部树三级更新均落；主会话已接；ops 路径复制 + 桥缓存 + props/结构 view→ops 已落                              | replace / collection 模板 / 叶子 props 删键已接；有子节点 props 删键仍全量；data batch 已接（一次提交、单次通知）；页面侧表尚未进 local-trees payload（S7 来源热更新一起定） |
| 规则       | 标量 `in` / `bind` → props 已落                                                                                               | 触发 × 效果闭集、dispatch 回来源、规则索引/诊断未做                                                                                                                          |
| 集合       | 模板实例化 + keyed reconcile；全量更新不移除重挂                                                                              | 嵌套集合、坏条目上报、窗口化未做                                                                                                                                             |
| 权限       | ops / data / applyFull + 链接期挂载检查，E-PERMISSION + 审计                                                                  | observe / intercept、source 级权限未做；非安全边界                                                                                                                           |
| 生命周期   | EngineRuntime 账本：逆序清理、错误隔离、幂等                                                                                  | 渲染层媒体 / 订阅清理点未接                                                                                                                                                  |
| 组件词表   | 38 个 kind + Slot 原生结构 kind + registry 已落                                                                               | schema 单一来源与代码生成未做                                                                                                                                                |
| 渲染层     | DOM renderer + 38 kind + 跨父 move + 节点统计                                                                                 | —                                                                                                                                                                            |
| 启动骨架   | Vite 构建期把 Slot 首帧编译进 HTML（view → link → DOM）                                                                       | —                                                                                                                                                                            |
| 主会话     | 默认走 Slot（局部树 → TS 链接 → EngineRuntime）；legacy 快照路径已删                                                          | —                                                                                                                                                                            |
| 运行后来源 | `SourceEngine.registerSource/removeSource` + `applyView(keepOwners)`；示例 clock 自动发现并热更新                             | 远程 / worker 来源的网络帧、订阅与媒体登记、来源账本未接                                                                                                                     |

## 7. 术语

| 词                   | 意思                                                        |
| -------------------- | ----------------------------------------------------------- |
| **Slot**             | 唯一原语；可寻址的界面单元，带 id、layout、输入、反应、权限 |
| **局部树**           | 某个来源独立编写的一棵 Slot 树；引擎的输入                  |
| **根树**             | 引擎把局部树链接后的唯一权威文档                            |
| **来源（producer）** | 提供局部树或数据的实体；插件只是其中一种 adapter            |
| **链接 / 编译**      | 把局部树解析、定序、拼进根树并产诊断的过程                  |
| **反应（reaction）** | 事件/数据/生命周期/路由触发的一组效果声明                   |
| **集合绑定**         | Slot 上的闭合原语：按 key 用模板实例化条目                  |
| **更新集合**         | 一次原子更新涉及的 slot 集合（单槽 / 一批 / 内部节点）      |
| **全寻址**           | 引擎内部每个 Slot 都能按 id 定位                            |
| **可介入**           | 外部来源被 `grant` 允许去读/挂/换/改/观测                   |

## 8. 讨论与基线

- 设计讨论：2026-11-12 ~ 2026-11-13。
- 基线：`main@3910928`（S6.5 骨架编译后）；legacy 已删，分层与目录整改完成（PR #79–#84）。
- 收敛前的材料：旧提案归档在 [archive/ui-engine-subsystem.md](archive/ui-engine-subsystem.md)；旧 legacy 文档（`ui-engine.md` / `ui-plugins.md`）已删除，内容并入本系列。
- 产品页面设计（[ui-rules.md](../design/ui-rules.md)、[ui-home.md](../design/ui-home.md)、[ui-capture.md](../design/ui-capture.md)）不属于引擎契约，留在 `docs/design/`，引擎文档只链接。

## 9. 落地阶段

| 阶段 | 内容                                                   | 状态                                                      |
| ---- | ------------------------------------------------------ | --------------------------------------------------------- |
| S0   | 收尾：仓库结构迁移单独 PR；提案文档入 docs；修过期数字 | ✅                                                        |
| S1   | 契约：Slot 序列化 + 跨语言 fixture                     | ✅ S1.1（schema 单一来源未做）                            |
| S2   | 链接期组合：诊断码、顺序模型、构建期编译门禁           | ✅ 第一版（按 kind schema 未做；static_ui 已升级）        |
| S3   | 三张索引 + 三种更新 + 集合绑定                         | ✅ a–e（主会话已接）                                      |
| S4   | 权限薄层 + 生命周期账本 + 观测指标                     | ✅（applyFull 已收；observe/intercept 见 permissions §8） |
| S5   | 来源宿主 + 渲染节点统计 + TS 宿主                      | ✅ 来源宿主 / 渲染统计；运行后来源示例已落（S7.1）        |
| S6   | 主会话接入：Python 产 Slot → TS 主入口 → 删 legacy     | ✅ S6.1–S6.5（主入口 / 骨架 / legacy 删除）               |
| S7   | 运行后来源 / Host 网络接线；规则执行与 schema 单一来源 | ◐ 运行后来源示例已落；网络帧 / 规则 / schema 未落         |

各阶段的逐条进度记录在 [migration.md](migration.md) §1 的阶段注记里；本文只保留阶段表。

## 10. 文档状态约定

每份文档头部写一行状态，四档：

- **现状**：代码已实现，文档描述当前行为；
- **已定未实现**：契约已定，代码还没跟上；
- **提案**：还在讨论，可能变；
- **已废弃**：保留历史，不再有效。

文档不是代码的说明书：契约与现状冲突时，先看状态；要改契约，先改文档，再改代码。

# Dendrolink（Dendro）· 树链引擎

> **Dendrolink：把局部树链接成权威根树的链接期引擎。**
>
> 状态：**设计已定，实现未开始**。本文是引擎文档集的索引与总纲；契约细节在后续文档里，代码当前仍是 v1 渲染器。
> 基线：main@f090ea1（另有未提交的仓库结构迁移 refactor/repo-layout）。
> 命名决定见 [ADR-0001](decisions/0001-name.md)。

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
| schema        | `dendro.ui/2`                                                                            |
| 引擎内置 kind | `dendro:slot` / `dendro:page` / `dendro:layer` / `dendro:window`                         |
| 宿主导入 kind | 保持 `ideas:card` 这种                                                                   |
| id 前缀       | `dendro.window` / `dendro.window.page`                                                   |
| CSS 前缀      | `dendro-`                                                                                |
| 包名          | `@dendro/runtime`（或 `dendro-runtime`）                                                 |
| 文档目录      | `docs/engine/`                                                                           |

## 4. 文档地图

本文档集按“一个概念一个家”拆；状态见下表。

| 文档                                      | 负责什么                                                 | 状态   |
| ----------------------------------------- | -------------------------------------------------------- | ------ |
| `README.md`                               | 索引、定位、命名、术语、实现状态                         | 已写   |
| `decisions/0001-name.md`                  | 命名决定与影响                                           | 已写   |
| `decisions/0002-no-react-dom-renderer.md` | 移除 React、渲染层直写 DOM 的决定                        | 已接受 |
| [contract.md](contract.md)                | Slot 原语、字段、schema、版本、kind 注册                 | 已写   |
| [addressing.md](addressing.md)            | id 规则、三张索引、更新集合、全寻址 vs 可介入            | 已写   |
| [structure.md](structure.md)              | window/page/layer/layout、页面切换的按 id 协调           | 已写   |
| [rules.md](rules.md)                      | 触发 × 效果闭集、数据输入、规则索引                      | 已写   |
| [collection.md](collection.md)            | 集合绑定、模板、keyed reconcile、条目实例 id             | 已写   |
| [composition.md](composition.md)          | 局部树、编译/链接、顺序模型、诊断、root tree 归属        | 已写   |
| [updates.md](updates.md)                  | 三种更新、事务、版本、兜底、重同步                       | 已写   |
| [permissions.md](permissions.md)          | 能力 × 主体、默认分层、检查点、非安全边界                | 已写   |
| [runtime.md](runtime.md)                  | 引擎分层、生命周期账本、失败隔离、诊断面板               | 已写   |
| [renderer.md](renderer.md)                | 渲染层：Kind 接口、DOM 协调、测试约定                    | 已写   |
| [components.md](components.md)            | 组件词表、schema 单一来源、authoring API 与 wire 形态    | 已写   |
| [wire.md](wire.md)                        | 引擎 payload 形状；帧/传输仍归 `docs/design/protocol.md` | 已写   |
| [testing.md](testing.md)                  | 九条不变量、fixture、编译诊断测试、集合等价测试          | 已写   |
| [migration.md](migration.md)              | v1→v2、兼容层、S0–S5、旧文档去向                         | 已写   |
| [archive/](archive/)                      | 已退役的提案与旧设计                                     | 已退役 |

旧草案（`docs/design/ui-tree.md`）已拆入本系列并删除。

## 5. 阅读顺序

1. 本文：它是什么、叫什么、文档在哪。
2. `contract.md`：一个 Slot 长什么样。
3. `addressing.md` + `structure.md`：怎么找到它、它挂在哪。
4. `rules.md` + `collection.md`：它怎么动、数据怎么进来。
5. `composition.md` + `updates.md`：局部树怎么合成权威根树、之后怎么更新。
6. `permissions.md` + `runtime.md`：谁能动它、引擎内部怎么分层。
7. `components.md` + `wire.md` + `testing.md`：怎么加组件、线上长什么样、拿什么验收。
8. `migration.md`：从 v1 到 v2 怎么走。

## 6. 实现状态（与代码的差距）

文档写的是**契约**，不是现状说明书。当前代码是 v1 契约 + DOM 渲染器 + v2 链接器/运行时核心：490 条 Python 测试、797 条 TS 测试全绿，但离本文的模型还有距离。

| 能力     | 代码现状（v1）                                                  | 目标                            | 状态                       |
| -------- | --------------------------------------------------------------- | ------------------------------- | -------------------------- |
| 节点契约 | `{type, props, children}`，无 layout/reactions/collection/grant | Slot 信封                       | 已定未实现                 |
| 文档契约 | 无（只有 v1 节点）                                              | Slot/Document v2 类型 + fixture | S1.1 已落，运行时未接入    |
| 寻址     | 位置 + handler 代次（`owner:serial:index`）                     | 稳定 id + 三张索引              | 已定未实现                 |
| 组合     | TS 组合器 + 全局键；Python 只发 append                          | 链接期编译 + 诊断               | 已定未实现                 |
| 更新     | 全量 + 路径补丁                                                 | 全量 / 数据 / 局部树            | 已定未实现                 |
| 规则     | 回调塞在 props 里                                               | 结构 + 规则两张网               | 已定未实现                 |
| 集合     | 插件自己组条目树                                                | 模板 + keyed reconcile          | 已定未实现                 |
| 权限     | 无                                                              | 能力 × 主体                     | 设计概念，格式先留         |
| 生命周期 | Python `ctx.effect`；TS 无账本                                  | 引擎级挂载/卸载账本             | 已定未实现                 |
| 组件词表 | 38 个 kind，Python/TS 两处手写                                  | schema 单一来源 + 代码生成      | 已定未实现                 |
| 渲染层   | DOM kind 词表 + DomRenderer（React 已删除）                     | 同左，38 个 kind 全覆盖         | 已落                       |
| 启动骨架 | 空数据快照 + 运行时解释整棵树                                   | 构建期编译成首帧 HTML           | 已落（首帧；无 hydration） |

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
- 基线：`main@f090ea1`；工作区另有未提交的仓库结构迁移（`refactor/repo-layout`）。
- 收敛前的材料：旧提案归档在 [archive/ui-engine-subsystem.md](archive/ui-engine-subsystem.md)；旧 v1 文档（`ui-engine.md` / `ui-plugins.md`）已删除，内容并入本系列。
- 产品页面设计（[ui-rules.md](../design/ui-rules.md)、[ui-home.md](../design/ui-home.md)、[ui-capture.md](../design/ui-capture.md)）不属于引擎契约，留在 `docs/design/`，引擎文档只链接。

## 9. 落地阶段

| 阶段 | 内容                                                                      | 退出条件                  |
| ---- | ------------------------------------------------------------------------- | ------------------------- |
| S0   | 收尾：仓库结构迁移单独 PR；提案文档入 docs；删已合并 worktree；修过期数字 | 工作区干净，CI 绿         |
| S1   | 契约：schema 单一来源；Slot v2 序列化；跨语言 fixture                     | 同一 fixture 两侧结论一致 |
| S2   | 链接期组合：诊断码、顺序模型、构建期编译门禁                              | 冲突在 CI 可复现          |

> S2 第一版已落：`app/ui-engine/src/link/`（v2 局部树 → 权威根树 + 诊断）、`sdk/local_tree.py`、共享 fixture 与 `vite build` 门禁。`static_ui.py` 升级、运行时接入与按 kind schema 待后续。

> S3-a 已落：`app/ui-engine/src/runtime/` 的文档状态/三张索引、局部树 ops（原子/版本/changed）、集合绑定原语，`sdk/update.py` + 共享 `ops.json`。

> S3-b 已落：`src/runtime/data.ts` 的 data router（revision 幂等、集合全量/增量、changed），`sdk/data.py` + 共享 `data.json`。

> S3-c 已落：标量 `in`/`bind` 绑定（`data_bind.ts`）、Session/pages/active、route op 与全量替换（`session.ts`），`sdk/update.py` 的 RouteOp + 共享 `route.json`。

> S3-d 已落：`src/dom/v2/`（Slot→DOM 薄桥 + 命名空间别名 + v2 原生结构 kind）、`runtime/hydrate.ts`、`runtime/page_switch.ts` 与 fixture→DOM 集成 spike。数据更新/全量替换不重挂已验证。

> S3-e 已落：renderer 跨父 move 复用元素（换页保留实例）、`?engine=v2` 预览入口（独立 chunk）、生命周期账本原语（S4 预落）。

> S4 第一版已落：`EngineRuntime`（session + 生命周期账本 + 指标 + 变更通知）、`DocumentView`（引擎 ↔ DOM）、权限薄层（ops/data 运行期 E-PERMISSION）。

> S4 续落：链接期挂载权限（含 base grant 归一化）、`SourceHost`（来源注册/死引用级联/fail closed）、`AuditLog` 与 apply 耗时/渲染计数。来源热更新与网络帧接线、`observe`/`intercept`、重渲染节点数、v2 替换主会话待续。

| S3 | 索引 + 三种更新 + 集合绑定；灵感页 spike | 数据更新不重挂；换页协调正确 |
| S4 | 权限薄层 + 生命周期账本 + 观测指标 | 越权拒绝；卸载零残留 |
| S5 | TS 宿主 / 组件命名空间 / 运行后来源 | 示例插件不改引擎源码即可加界面 |

## 10. 文档状态约定

每份文档头部写一行状态，四档：

- **现状**：代码已实现，文档描述当前行为；
- **已定未实现**：契约已定，代码还没跟上；
- **提案**：还在讨论，可能变；
- **已废弃**：保留历史，不再有效。

文档不是代码的说明书：契约与现状冲突时，先看状态；要改契约，先改文档，再改代码。

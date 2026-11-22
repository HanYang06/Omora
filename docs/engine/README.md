# Dendrolink（Dendro）· 树链引擎

> **Dendrolink：把静态结构 + 最小节点更新做成一份权威文档的运行时。**
>
> 状态：**V1 树（`dendro.tree/1`）是唯一格式与默认入口**（2026-11-20）。
> 旧 Slot 文档运行时（`dendro.ui/1`、链接期组合、EngineRuntime/DocumentView、启动骨架）已删除；
> 它的设计记录保留在 [decisions/](../decisions/)、[archive/](archive/)、[migration.md](migration.md)
> 与 [changelog](../changelog.md)，不再代表代码现状。
> 命名决定见 [ADR-0001](../decisions/0001-name.md)，V1 的架构决定见
> [ADR-0004](../decisions/0004-static-tree-minimal-updates.md)。

## 1. 它现在是什么

V1 引擎是一个 **V1 树文档运行时**：

- **输入**：插件用 `omora.sdk.ui` 的 Page / Node 写的页面树；`omora.sdk.tree_build`
  把它升成 `dendro.tree/1` 的 base + 局部树（构建期与运行期同一份桥）。
- **结构**：真实页面在构建期 compose 成每页一份文档（`scripts/static_tree.py` →
  `dist/tree/`）；运行时不再组织结构，只挂载。
- **更新**：事件后 Python 产差分 ops（`setProps` / `mount` / `unmount`），TS 按 id
  原子应用、只 patch 被触碰的子树；差分表达不了就回整树，客户端整棵替换。
- **异步变化**：`ui.changed` 推同一套 ops / 整树；首帧 / 重连走 `ui.tree` 全量。
- **持久化**：引擎不落盘；构建产物是唯一的静态快照。

数据（`document.data`）目前只有 TS **文档层**：`data` op 能按 revision 写
`data[source]`，collection / bind 的消费语义还没接产线；运行期 ops 的`data` /
`replace` 形状已经定义、应用端已实现，但 Python 的 `tree_event` 还没发它们。

## 2. 文档地图

现行事实来源：

| 文档                                         | 负责什么                                                                    |
| -------------------------------------------- | --------------------------------------------------------------------------- |
| [runtime-semantics.md](runtime-semantics.md) | 运行时语义：数据权威、行为、权限边界、协议、持久化、失败——**V1 的权威口径** |
| [tree-ops.md](tree-ops.md)                   | `dendro.tree/1` 的 ops 线上形状、应用端语义、跨语言 fixture                 |
| [tree-runtime.md](tree-runtime.md)           | V1 运行时：TreeRuntime / 宿主 / 渲染适配、目前接了什么                      |
| [build.md](build.md)                         | 构建期 compose 与 `dist/tree/` 产物                                         |
| [wire.md](wire.md)                           | 线上 payload：`tree` / `ops` / `ui.changed` / 事件回传与诊断                |
| [renderer.md](renderer.md)                   | kind 接口、DOM 协调、V1 适配层、测试约定                                    |
| [components.md](components.md)               | 组件词表、authoring API、schema 单一来源仍是【建议】                        |
| [layering.md](layering.md)                   | 当前目录分层与依赖方向                                                      |
| [testing.md](testing.md)                     | 测试分层、命令、覆盖范围                                                    |

历史（Slot 时期，代码已删除，仅作设计记录）：

| 文档                             | 记的是什么                                             |
| -------------------------------- | ------------------------------------------------------ |
| [contract.md](contract.md)       | Slot 节点信封、`dendro.ui/1` 文档契约                  |
| [addressing.md](addressing.md)   | Slot 的 code / chain / addr 身份与三张索引             |
| [structure.md](structure.md)     | 窗口 / 页面 / 层 / 布局、`root-tree.json` 骨架         |
| [rules.md](rules.md)             | 触发 × 效果闭集（留作 v2 规则边界）                    |
| [collection.md](collection.md)   | Slot 集合绑定与 keyed reconcile 的设计                 |
| [composition.md](composition.md) | 链接期组合、诊断码、局部树                             |
| [updates.md](updates.md)         | Slot 的三级更新（全量 / 纯数据 / 局部树）              |
| [permissions.md](permissions.md) | Slot 时期的权限薄层设计与“引擎不判定权限”的边界        |
| [runtime.md](runtime.md)         | Slot 时期的 EngineRuntime / SourceEngine / 指标 / 审计 |
| [migration.md](migration.md)     | legacy → Slot 的迁移记录（历史；Slot 已删除）          |
| [archive/](archive/)             | 更早的提案与旧设计                                     |

## 3. 阅读顺序

1. 本文：现状与文档地图。
2. [runtime-semantics.md](runtime-semantics.md)：V1 的运行时口径。
3. [tree-ops.md](tree-ops.md) + [tree-runtime.md](tree-runtime.md)：文档怎么被改、运行时怎么应用。
4. [build.md](build.md) + [wire.md](wire.md)：结构从哪里来、线上长什么样。
5. [layering.md](layering.md) + [renderer.md](renderer.md) + [components.md](components.md)：代码怎么分层、怎么加组件。
6. [testing.md](testing.md)：拿什么验收。
7. 历史文档按需查，不再作为实现依据。

## 4. 实现状态（与代码的差距）

**已落**（2026-11-22）：

- `dendro.tree/1` 契约、schema、Python / TS 校验、跨语言示例；
- 构建期 compose 与门禁：真实四页 → `dist/tree/`，kind 存在性、chain / id / order / pages 校验；
- 运行时：mount / replace / dispose、路径复制、原子回滚、DOM 宿主与 Kind 适配；
- ops：形状与跨语言 fixture、文档层应用（版本 / 原子 / 路径复制 / `changed`）、
  运行时 `setProps` / `mount` / `unmount` / `replace`；`data` op 文档层（revision 幂等 / 过期诊断）；
- 主会话：默认入口 V1 树（`ui.tree` 首帧、`ui.tree_event` 事件、`ui.changed` 异步变化）、
  导航与 handler 登记、设备上报；`?engine=tree` 产物预览、`virtual` / `dialog` 组件预览；
- 组件：38 个 kind + `app` + `page-link`（`treeKinds`）、a11y / i18n / placement 适配；
- 事件复杂度计量与棘轮：`sdk/tree_meter.py`（build / compose / walk 三阶段计数）+
  `packages/ui/tests/test_complexity.py`；
- `PageHandle.data` 发 `data` op（`value` / `items`，revision 按 source 递增），整树 / 重连时 `base.data` 带快照；
- collection 编写端（`Collection` + `bound()`）与 per-item 事件身份（payload `item`）；
  ideas 的 rail / feed 改走 collection + data，页面树与条目数无关；
- 旧 Slot 路径、`dendro.ui/1` 契约、Slot 测试与构建脚本全部删除。

**还没落**：

- Python 发射端仍按“改完重建整页 → 差分”出 ops，没有脏节点产线（ADR-0005 后置）；
- `changes` 增量（现在整批 `E-PAYLOAD`，items 全量仍 O(N)）、嵌套集合、窗口化之上的数据消费；
- 树内规则（`reactions`）、权限 / 审计接 V1、远程 / 运行后来源；
- per-kind `settings` schema、`on` / `bind` 引用校验（现在只查 kind 存在性）；

## 5. 术语

| 词             | 意思                                                                  |
| -------------- | --------------------------------------------------------------------- |
| **V1 树**      | `dendro.tree/1` 文档：稳定 id / chain / order 的节点树                |
| **base**       | 一页的骨架：`app` 根 + 导航 / 主区目录 + 页面容器 + 页面侧表          |
| **局部树**     | 构建期 / 运行期挂进 base 的子树（导航条目、页面内容）                 |
| **ops**        | 按 id 改一份已存在文档的原子批量；一个批量涨一个版本                  |
| **整树回退**   | 差分表达不了的变化，直接回一份 `kind:"tree"` 让客户端整棵替换         |
| **ui.changed** | `set_page` / `refresh_page` 之后的异步变化推送，payload 同 ops / 整树 |

## 6. 历史阶段（Slot 时期，已结束）

| 阶段  | 内容                                          | 结局                       |
| ----- | --------------------------------------------- | -------------------------- |
| S0–S2 | 仓库结构、Slot 契约、链接期组合与构建门禁     | 代码已删，记录在 migration |
| S3–S4 | 三级更新、集合绑定、权限薄层、EngineRuntime   | 代码已删，记录在 migration |
| S5–S6 | 来源宿主、渲染节点统计、Slot 主会话、启动骨架 | 代码已删，记录在 migration |
| S7    | 运行后来源示例                                | 随 Slot 删除，未迁 V1      |

逐条进度注记在 [migration.md](migration.md) §1；按 [ADR-0004](../decisions/0004-static-tree-minimal-updates.md)，
V1 取代 Slot，不再维护双路径。

## 7. 文档状态约定

每份文档头部写一行状态，四档：

- **现状**：代码已实现，文档描述当前行为；
- **已定未实现**：契约已定，代码还没跟上；
- **提案**：还在讨论，可能变；
- **历史**：保留设计记录，不再代表代码现状。

文档不是代码的说明书：契约与现状冲突时，先看状态；要改契约，先改文档，再改代码。

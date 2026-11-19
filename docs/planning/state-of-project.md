# 项目现状（2026-11-20）

> 状态：**阶段快照**。每次阶段复盘重写，不滚动追加。
> 这份文件只回答三件事：现在到底有什么、哪些说法已经和代码对不上、哪些债在拖后腿。
> 方向看 [路线图](../roadmap.md)，目标架构看 [V1 树](v1-tree.md)，队列看 [TODO](../todo.md)。

## 0. 怎么得到的

- **读**：`docs/` 现行文档 + 代码目录 + git 历史。
- **跑**：pytest、vitest、tsc、ruff、mypy、eslint、prettier、Playwright、`scripts/todo.py`、`scripts/docs_links.py`。
- **数**：测试数由命令统计，文档自述不作数。

## 1. 事实基线

| 项          | 实测（2026-11-20）                                  | 口径                            |
| ----------- | --------------------------------------------------- | ------------------------------- |
| 界面格式    | **只有 `dendro.tree/1`**；Slot / `dendro.ui/1` 已删 | 代码 + 文档                     |
| 默认入口    | V1 树主会话（连 Python，拉 `ui.tree`）              | `app/ui-engine/src/app/main.ts` |
| Python 测试 | 465 条（收集）；覆盖率地板 95%（CI）                | pytest / pytest-cov             |
| TS 测试     | 499 条（本分支实测）                                | vitest                          |
| 浏览器测试  | 4 条（tree 预览 + a11y、virtual、dialog）           | Playwright                      |
| 版本        | 0.1.0；0 tag、0 release                             | `VERSION` / `git tag`           |
| 门禁        | 绿                                                  | 上面列出的命令                  |

## 2. 演进脉络（到拆桥为止）

| 日期     | 做了什么                                                       | 留下什么                         |
| -------- | -------------------------------------------------------------- | -------------------------------- |
| 11-07~15 | 内核 / SDK / 插件骨架；三栏灵感页、搜索、捕捉；Slot 文档运行时 | 产品雏形 + 第一代 UI 运行时      |
| 11-16~18 | 身份 / addr / 增量更新；V1 树契约、compose、runtime mount      | ADR-0004：V1 是目标架构          |
| 11-19    | V1 data op 文档层、运行时最小更新、默认入口切 tree             | V1 接管默认入口                  |
| 11-20    | 两条拆桥分支（TS / Python）删 Slot；文档切到 V1 事实来源       | 单一格式、单一入口、单一文档口径 |

## 3. 真实的能力边界

### 3.1 产品现在能做什么

- **三栏首页**：56px 图标栏 + 索引栏 + 主区；灵感、项目、需求、插件四个入口。
- **搜索**：标题子串匹配，出联想，回车进结果页，结果带命中片段。
- **捕捉**：文字、录音（波形 / 暂停 / 按住空格对讲 / 录了即存）、录像（HTTP 媒体通道）。
- **组织**：置顶、归档、详情页；索引栏全量列表。
- **持久化**：SQLite + 媒体文件，都在 `.omora/`。
- **默认链路**：插件写 Page / Node → `tree_build` 桥 → `ui.tree` → TS compose 挂载；
  点击 → `ui.tree_event` → ops patch（或整树兜底）；`ui.changed` 推异步变化。

### 3.2 产品现在不能做什么

- 不能新建项目 / 需求；两个页面是空页。
- 不能让灵感、项目、需求互相关联。
- 不能跨域检索；搜索只搜 `ideas.title`。
- 不能转写、不能 AI、不能深色、不能窄屏、不能多端。
- 不能部署成网页：没有 server 入口，只有 `omora dev`。
- 没有发布物：无 tag、无安装包、无 release notes。

### 3.3 引擎现在能做什么

- **V1 文档**：`dendro.tree/1` 契约、Python / TS 校验、跨语言示例、构建期 compose、`dist/tree/` 产物。
- **V1 运行时**：TreeRuntime 的 mount / replace / dispose、路径复制、原子回滚、DOM 宿主与 Kind 适配。
- **更新**：ops 形状与 fixture、文档层应用、运行时 `setProps` / `mount` / `unmount` / `replace`；
  `data` op 文档层（revision 幂等 / 过期诊断）。
- **前端主路径**：默认入口 tree-live（`ui.tree` / `ui.tree_event` / `ui.changed`）、
  `?engine=tree` 预览、virtual / dialog 预览、导航与事件、设备上报。
- **组件**：38 个 kind + `app` / `page-link` / `dialog` / `virtual-list`。
- **桌面壳**：Electron 主进程在 `app/ui-engine/shell/`。

### 3.4 引擎没做完

- **Python 没有脏节点产线**：事件后仍重建整页再差分；发出去的是 ops，但计算仍是 O(N)。
- **data / collection 产线**：TS 有文档层与集合原语；Python 还没发 `data` op，
  `bind` / `changes` / collection 消费未接。
- **树内规则**（`reactions`）不执行；schema 仍两份手写。
- **权限 / 审计 / 远程来源**未接 V1；没有复杂度护栏。
- **首帧**：连接后挂载，没有预渲染；`dist/tree` 只服务 `?engine=tree` 预览。

## 4. 债（按代价排序）

| 债                     | 证据                                     | 代价                               | 处理窗口   |
| ---------------------- | ---------------------------------------- | ---------------------------------- | ---------- |
| Python 侧仍是整页重建  | `ui.tree_event` 后 `_build_tree` 全页    | 协议省了，CPU / 内存没省；大页会卡 | 现期       |
| data / collection 未接 | Python 无 data op；bind / changes 无产线 | 数据驱动界面的承诺兑现不了         | 近期       |
| 无权限 / 审计          | V1 引擎没有 guard 检查点                 | 只能靠进程内约束                   | 近期       |
| 无复杂度护栏           | 没有斜率测试                             | 回归靠人看                         | 近期       |
| 无迁移 runner          | 开发期 DROP、发布期报错退出              | 第一次发布后每加字段都要手写迁移   | 0.2 发布前 |
| 无发布流程             | 0 tag、0 release、无安装包               | “能跑”无法交付给用户               | 长期前段   |
| 安全 advisory          | 1 high 临时 ignore；5 moderate 未评估    | 供应链风险，且有复审期限           | 12-31 前   |
| 产品闭环缺失           | Project 空页；Idea 无关联 / 转写         | 核心价值未兑现                     | 长期       |

## 5. 文档与代码对不上的地方

| 位置                                 | 曾经的说法              | 现在                                 |
| ------------------------------------ | ----------------------- | ------------------------------------ |
| 根 README / AGENTS / ARCHITECTURE    | Slot 默认入口           | 已改：V1 树唯一格式与默认入口        |
| `docs/engine/README.md`              | Slot 运行时是主线       | 已重写：V1 索引 + 历史文档分区       |
| `docs/engine/wire.md`                | Slot view / local-trees | 已重写：tree / ops / ui.changed      |
| `docs/engine/testing.md`             | Slot 测试分层           | 已重写：Python / vitest / Playwright |
| `docs/planning/v1-tree.md`、roadmap  | V1 分阶段接管           | 已改：拆桥完成，剩引擎收口           |
| contract / addressing / structure 等 | Slot 契约与机制         | 加“历史”状态，保留设计记录           |

## 6. 这份快照没做的事

- 没有改任何代码。
- 没有改写 ADR / archive / changelog 里的历史记录。
- 没有评估性能、无障碍、国际化——不在本轮范围。

# AGENTS.md

Omora 正在从零重写。这份文件是根规则，只写每次都必须知道的；细节在 `docs/` 与 skill 里。

权威顺序：`docs/ARCHITECTURE.md` > 本文件 > 个人偏好。冲突时以文档为准，并顺手修正本文件。

## 项目

本地优先的灵感与项目管理工具：灵感、项目、需求互相可追溯；默认本地跑，网页形态（server）未实现，远期再看。

当前状态：闭环已通，母 UI（浅色，三栏：图标栏 + 索引栏 + 主区）+ 界面库 + 灵感页 + 传统搜索 + 音频 / 视频捕获（两个独立插件、客户端设备门禁）+ uv workspace 已落——`omora-core` / `omora-sdk` / `omora-plugin-*`、boot / 配置、store（SQLite）/ manager / media / ui / audio / video / ideas / projects / requirements / net 插件、渲染引擎（`app/ui-engine/`）。React 已移除，渲染层直写 DOM。界面只有一种格式 **`dendro.tree/1`**：静态结构 + 最小节点更新，默认入口是 V1 树主会话（Python 产 base + 局部树 → TS compose → 按 id patch）；旧 Slot（`dendro.ui/1`、链接期组合、EngineRuntime/DocumentView、启动骨架）已删除，历史留在 `docs/engine/decisions/`、`docs/engine/archive/` 与 [changelog](docs/changelog.md)。V1 已落：树契约 / 跨语言校验、`omora.scope/1` node scope、`omora.page/1` Page/State/When/Bind、构建期 compose（真实四页产物）、运行时 mount / replace / ops 文档层与运行时最小更新、`ui.tree` / `ui.tree_event` / `ui.changed`、导航与事件。仍待：Python 侧脏节点产线（现在事件后重建整页再差分）、data / collection 产线（TS 文档层与集合原语已落，Python 还没发 data op）、树内规则（`reactions`）、权限 / 审计接 V1、复杂度护栏、远程来源、schema 单一来源。组件库已落；深色主题、转写、AI 待做；项目 / 需求仍是空页。方向 / 现状 / 队列 / 完成分别看 `docs/roadmap.md` / `docs/planning/state-of-project.md` / `docs/todo.md` / `docs/changelog.md`。

## 结构

| 位置             | 是什么                                                                           | 语言    |
| ---------------- | -------------------------------------------------------------------------------- | ------- |
| `app/core/`      | 内核：插件宿主；package `omora-core`                                             | Python  |
| `app/sdk/`       | 插件 API（SDK）：Context / Plugin / UI 节点 / 协议；`omora-sdk`                  | Python  |
| `packages/`      | 系统插件：`omora-plugin-*`，uv workspace 的 member                               | Python  |
| `app/ui-engine/` | 渲染引擎 + 桌面壳：V1 树运行时、组件、构建期 compose；Electron 主进程在 `shell/` | TS / JS |
| 运行后插件目录   | 生态插件，单独装；现在为空                                                       | 待定    |
| `schema/`        | 机器可读契约：`dendro.tree/1` / `omora.scope/1` / `omora.page/1`                 | JSON    |
| `docs/`          | 架构与事实来源                                                                   | —       |

两个进程、两个 runtime：Python（内核 + 插件）与 TS（渲染引擎）。中间只有一条消息协议，由 net 插件（系统插件）持有。

## 不可协商

1. **内核只认插件。** 只有加持、持有、引用、运行四件事。不转发消息，不解析帧。
2. **内核里没有 UI。** 界面树、组件、节点对内核都是不透明数据。
3. **内核里没有领域词。** 灵感 / 项目 / 需求只出现在插件里。
4. **插件不 import 内核。** 只依赖插件 API；缺能力就补 API，不开洞。
5. **插件之间只靠服务名。** 不互相 import。
6. **配置只读。** 只在启动期读一次，应用不写；设置不得写回配置。
7. **系统插件不单独定版本。** 版本号 = 软件版本号；独立发版本就是制造兼容灾难。
8. **文档是事实来源。** 代码与 `docs/ARCHITECTURE.md` 冲突时改代码；要改文档，先说清楚为什么。
9. **先有疼的问题，再加概念。** 说不出来就不加。

## 工作方式

- 不确定就问，不猜需求；有多种解释就列出来。
- 一次只做一件事；不顺手改邻近代码。
- 多区任务走 Agent 团队：Lead 拆任务（写域/依赖）→ 每个 teammate 自己的 worktree/分支 → 合成一条集成分支 → **只开一个 PR** → Lead review → 由项目作者合并；review 问题回给 owner 改，Lead 不亲自改别人的分支/worktree；详见 [omora-team](.agents/skills/omora-team/SKILL.md)。
- **Agent 要复用，不要一任务一 spawn**：同类任务优先 send_message 唤醒 inactive teammate；每轮默认 1 个、最多 2 个，超了先问用户；小任务 Lead 自己做；spawn 前必须查 `list_agents` 并说明为什么不能复用。
- **一个功能 = 一个 PR**：同一件事的文档、实现、测试放在同一个 PR 里，PR 内按事件拆提交。多区并行也只提一个 PR。只有要独立回滚、或一次 review 看不完（净变更 > 800 行）才拆。
- **合并权在项目作者**：agent 只开 PR、不做 `gh pr merge`，也不等前一个 PR 合并——该发几个就发几个，可以基于未合并分支继续叠 PR；从哪条分支开顺手从哪条开。
- **计划分三层**：`docs/roadmap.md` 只写方向与退出条件；`docs/todo.md` 只写未完成工作，每项必须有 `owner:` / `next:`；`docs/changelog.md` 只记完成。开工前读 TODO，完成即迁移；`uv run python scripts/todo.py` 检查格式。
- 跑过才算完成；跑不了就明说没验证。
- 不用"应该可以""理论上没问题"。

## 环境

- 系统 `python` 是 Windows 商店占位，不可用；Python 命令一律走 `uv run`。
- 前端依赖走 `pnpm`；根目录一个 workspace，一次 `pnpm install` 装齐渲染端与桌面壳；shell 不再单独成 workspace。
- Python 侧是 uv workspace：`uv sync` 一个 lock / 一个 venv；每个包自己的 pyproject / 依赖 / `omora` 命名空间 / tests。
- 开发：`uv run omora dev`（内核 + 渲染引擎；`--shell` 连桌面壳；`-v` 看 debug 日志）。
- 仓库统一 LF；不提交 `.venv/`、`node_modules/`、`dist/`、本地数据。

门禁：`.github/workflows/ci.yml`（ruff / mypy / pytest + 覆盖率 / eslint / prettier / tsc / vitest + 覆盖率 / 安全扫描 / 构建 / Windows）。一条命令一个 step，不套壳；本地按 `docs/design/ci.md` 的命令逐条跑。交付必须附上实际跑过的命令和输出。

## 停下来问

- 需求有歧义，或存在多种合理解释；
- 要改目录结构、协议形状或依赖方向；
- 要动 `docs/` 里的事实来源；
- 发现规则本身有问题（改规则，不要绕）。

## 提交

按 [omora-git](.agents/skills/omora-git/SKILL.md)：`type(scope): subject`，一次一件事，`main` 只经 PR 合并。**合并由项目作者手动执行**；agent 只开 PR、保持分支可合并，不代替作者点合并。

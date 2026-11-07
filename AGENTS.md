# AGENTS.md

> 本文件是 AI 在本仓库工作的根规则。只写"无法从代码推断、但每次都必须知道"的内容；细节指向 `docs/` 与项目 skill。
> 权威顺序：`docs/` 事实来源 > 本文件 > 个人偏好。冲突时以 `docs/` 为准，并顺手修正本文件。

## 项目

Omora：本地优先的灵感与项目管理工具。灵感、项目、需求互相可追溯；默认本地运行，也可部署为服务器；能力由插件扩展，秉持"一切皆插件"。

- 内核：Python（逻辑、存储、事件、权限、插件宿主）
- 渲染层：TypeScript（声明式渲染器 + 槽位 + 壳）
- 两者之间只有协议：C1（内部）/ C2（插件）/ C3（UI 数据）
- 当前阶段：P0 垂直切片进行中。已完成 M0.0 门禁、M0.1 服务容器、M0.2 存储与事件日志；进行中 M0.3 传输、M0.4 渲染器；未开始 M0.5 插件宿主、M0.6 集成验收
- 版本：`0.1.0`，统一版本发布（见 [ADR-0003](docs/decisions/0003-unified-versioning.md)）

## 工作方式

**先想清楚，再动手；改动尽量小；结论必须有证据。**

- 不确定就问，不猜需求；有多个解释时列出来，不要默认选一个。
- 能复用就复用，不写投机性抽象；第一个用例不做框架。
- 只改必须改的；不顺手重构邻近代码，不做无关格式化。
- 说"完成"之前必须跑过；跑不了就明说没验证。

## 环境

- 系统 `python` 是 Windows 商店占位，不可用。一切 Python 命令走 `uv run`。
- 首次准备：`uv sync --all-packages --all-groups`；前端依赖：在 `web/` 下 `pnpm install`。
- `web/pnpm-workspace.yaml` 里放行了 esbuild 的构建脚本，不要删。
- 仓库统一 LF；不要制造"只改一行、整文件都变"的 diff。
- 不提交：`.venv/`、`node_modules/`、`dist/`、`.build/`、各类缓存。
- 钩子已启用（`git config core.hooksPath .githooks`）；新克隆需要执行一次。
- 仓库规则集要求 `main` 只能经 PR 合并（merge commit），且 PR 分支需有 CodeQL 扫描结果；CodeQL 默认扫描已启用。

## 常用命令

| 目的 | 命令 |
|---|---|
| 全部门禁 | `uv run python scripts/check.py` |
| 查看阶段 | `uv run python scripts/check.py --list` |
| 格式化检查 | `uv run ruff format --check .` |
| Lint | `uv run ruff check .` |
| 类型检查 | `uv run pyright` |
| 测试 | `uv run pytest -q` |
| 架构边界 | `uv run lint-imports` |
| 前端检查 | `cd web; pnpm exec eslint .; pnpm exec tsc --noEmit; pnpm exec vitest run` |

## 仓库结构

| 目录 | 职责 | 依赖方向 |
|---|---|---|
| `sdk/` | 插件 SDK，插件唯一可依赖的包 | 无内部依赖 |
| `kernel/` | 内核：服务容器、存储、事件、插件宿主 | 可依赖 `sdk` |
| `plugins/` | 官方插件（与第三方同 API） | 只能依赖 `sdk` |
| `protocol/` | C2 清单与 C3 节点 schema | 无 |
| `web/` | 渲染器、组件词表、壳 | 只能经 `rpc/` 访问内核 |
| `scripts/` | 门禁与工具 | 不写业务 |
| `docs/` | 架构、ADR、工程纪律 | 事实来源 |
| `.agents/skills/` | 项目 skill（`omora-project` / `omora-testing`） | — |

## 不可协商的规则

1. **门禁全绿才算完成。** 没有证据的"完成"等于没完成。
2. **内核零领域词汇。** 出现 Idea / Project / Kanban，说明边界破了。
3. **官方功能无后门。** 插件只依赖 `omora_sdk`；缺能力就补 API，不开洞。
4. **UI 是数据。** 插件产出声明式节点树（C3），不碰 DOM / CSS / 全局样式。
5. **内核是唯一真相源。** 命令上行、事件下行、UI 只是投影。
6. **契约变更三件套。** schema + 生成物 + changelog contract 段；主版本号只用于契约破坏。
7. **预算超了拆代码，不改预算。** 阈值在 `budget.json`。
8. **测试测行为。** 不做类型 / 非空 / 数值凑数。

## 任务流程

**开工前**

1. 读 [文档索引](docs/README.md) → [工程纪律](docs/engineering/discipline.md) → 相关 ADR → 项目 skill。
2. 复述任务边界，列出准备改的文件。
3. 非平凡改动先给计划：改什么、为什么、怎么验证。

**实现时**

- 先读后写；没读过的文件不改。
- 一次一件事，重构与功能分开。
- 不擅自：扩范围、加依赖、改契约、改版本、动目录结构。
- 卡住就停，报告阻塞点并给选项。

**交付前**

1. 跑门禁，全绿。
2. 报告四项：改了什么 / 为什么 / 怎么验证（命令 + 输出）/ 什么没验证。
3. 不使用"应该可以""理论上没问题"。

## 测试

写测试前读 [omora-testing](.agents/skills/omora-testing/SKILL.md)。三条底线：

- 这个测试失败时，能指出哪个行为坏了？
- 断言的是行为，不是类型 / 非空 / 实现细节？
- 是否可重复（无真实时间、网络、随机依赖）？

覆盖率是探针，不是目标。边界与不变量优先用属性测试，不手写排列组合。

## 提交与版本

- 完整规则见 [omora-git](.agents/skills/omora-git/SKILL.md)：格式、字数、分支、PR、合并方式。
- 格式：`type(scope): subject`；标题 ≤ 72 字符，subject 4–50 字符。
- 一次提交一件事；提交前自查 diff。
- `main` 只经 PR 合并，使用 merge commit（非线性）；禁止 squash / rebase / 本地合并。
- 版本单一来源 `VERSION`；仓库内所有包同号。

## 停下来问的情况

- 需求有歧义，或存在多种合理解释。
- 要改契约、版本、目录结构或依赖方向。
- 要动 `docs/` 里的事实来源。
- 发现规则本身有问题（这时候改规则，不要绕）。
- 需要密钥、外部账号或网络访问。

## 禁止

- 声称测试通过但没跑。
- 改测试迁就实现。
- 用注释代码或 TODO 占位。
- 为通过检查而放宽检查。
- 静默重试掩盖失败。
- 修改未读过的文件。
- 提交密钥或本地生成物。

## 文档地图

- [架构总览](docs/architecture/overview.md)
- [三份契约](docs/architecture/contracts.md)
- [核心边界](docs/architecture/core-surface.md)
- [工程纪律](docs/engineering/discipline.md)
- [依赖登记](docs/engineering/dependencies.md)
- [P0 计划](docs/roadmap/p0.md)
- [ADR-0001 技术栈](docs/decisions/0001-stack-and-runtime.md)
- [ADR-0002 核心边界](docs/decisions/0002-core-boundary.md)
- [ADR-0003 统一版本](docs/decisions/0003-unified-versioning.md)
- 项目 skill：`omora-project`、`omora-testing`、`omora-git`

## 维护本文件

本文件是根规则，任何修改都会全局生效。改之前先确认它确实该变（而不是该写进 `docs/`）；改完跑门禁。

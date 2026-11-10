# Omora

本地优先的灵感与项目管理工具：灵感、项目、需求互相可追溯。默认本地跑，也能部署成网页。

> 正在从零重写。闭环已通，母 UI（浅色）+ 界面库 v1 + 灵感页 + 传统搜索 + 音频 / 视频捕获 + uv workspace 已落；深色主题待单独设计。

## 架构

两个进程、两个 runtime：

- **Python 进程**：内核 + 系统插件。内核只做四件事——加持、持有、引用、运行。
- **TS 进程**：渲染引擎 + TS 插件。只画界面，不持有真相。
- 中间只有一条消息协议，由 net 插件持有。

细节看 [架构源码](docs/ARCHITECTURE.md)。

## 目录

| 位置             | 是什么                                         |
| ---------------- | ---------------------------------------------- |
| `app/core/`      | 内核：`omora-core`（workspace member）         |
| `app/sdk/`       | 插件 API：`omora-sdk`（workspace member）      |
| `app/packages/`  | 系统插件：`omora-plugin-*`（workspace member） |
| `app/ui-engine/` | 渲染引擎（TS）                                 |
| `docs/`          | 事实来源                                       |

Python 侧是一个 uv workspace：一个 lock、一个 venv；每个包有自己的 pyproject / 依赖 / 代码 / tests，import 命名空间是 `omora.*`。

配置：`config.ini` 随包、二进制、不可读；`config.yaml` 用户级、明文、只做覆盖。两者都只在启动期读，应用不写。

## 跑起来

首次装依赖：

```
uv sync
pnpm install
```

之后一条命令起内核和渲染引擎：

```
uv run omora dev
```

浏览器打开 http://127.0.0.1:5173；Ctrl+C 一起停。看到灵感页，点「录音」说一句、点「录视频」拍一段，或者在输入框里记一条；点「归档」，条目消失。没有麦克风 / 摄像头时，对应按钮会禁用并写明原因。

本地数据在 `.omora/`（已忽略）：SQLite 和媒体文件都在里面。

## 门禁

CI 是唯一门禁，命令都在 `.github/workflows/ci.yml` 里，一条命令一个 step。本地要验证就逐条跑：

```bash
uv sync
pnpm install

uv run ruff check .
uv run ruff format --check .
uv run pytest --cov=app --cov-report=term-missing
uv run mypy -p omora.cli -p omora.core -p omora.sdk

pnpm exec eslint app/ui-engine/src app/shell/main.cjs
pnpm exec prettier --check .
pnpm --dir app/ui-engine exec tsc --noEmit
pnpm --dir app/ui-engine exec vitest run --coverage
```

为什么这么拆、覆盖率地板怎么定，见 [CI 与门禁](docs/design/ci.md)。

## 脚本

| 脚本                      | 作用                                                   |
| ------------------------- | ------------------------------------------------------ |
| `app/cli/`                | `omora` 命令：一条命令起内核 + 渲染引擎（`omora dev`） |
| `scripts/budget.py`       | 体量预算：文档与代码的文件行数上限，读 `budget.json`   |
| `scripts/docs_links.py`   | 文档相对链接检查：README、AGENTS、docs 与项目 skill    |
| `scripts/sync_version.py` | 把 `VERSION` 同步到各 package 元数据                   |
| `scripts/build.py`        | 发布构建，产物在 `dist/omora-<version>.zip`            |
| `scripts/commit_msg.py`   | 提交信息校验，由 `commit-msg` 钩子调用                 |

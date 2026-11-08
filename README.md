# Omora

本地优先的灵感与项目管理工具：灵感、项目、需求互相可追溯。默认本地跑，也能部署成网页。

> 正在从零重写。闭环已通：内核、boot / 配置、store / ui / net / inbox 插件与渲染引擎都已落。

## 架构

两个进程、两个 runtime：

- **Python 进程**：内核 + 系统插件。内核只做四件事——加持、持有、引用、运行。
- **TS 进程**：渲染引擎 + TS 插件。只画界面，不持有真相。
- 中间只有一条消息协议，由 net 插件持有。

细节看 [架构源码](docs/ARCHITECTURE.md)。

## 目录

| 位置 | 是什么 |
|---|---|
| `app/core/` | 内核（Python） |
| `app/packages/` | 系统插件（Python，随包发布） |
| `app/ui-engine/` | 渲染引擎（TS） |
| `docs/` | 事实来源 |

配置：`config.ini` 随包、二进制、不可读；`config.yaml` 用户级、明文、只做覆盖。两者都只在启动期读，应用不写。

## 跑起来

Python 侧（内核 + 系统插件）：

```
uv run python app/main.py
```

TS 侧（渲染引擎），另开一个终端：

```
pnpm --dir app/ui-engine install
pnpm --dir app/ui-engine dev
```

浏览器打开 Vite 给的地址：看到收件箱，点"归档"，条目消失。

## 门禁

```
uv run python scripts/check.py
```

## 脚本

| 脚本 | 作用 |
|---|---|
| `scripts/check.py` | 统一门禁：体量预算、测试、lint、类型、前端测试与构建 |
| `scripts/budget.py` | 体量预算：文档与代码的文件行数上限，读 `budget.json` |
| `scripts/docs_links.py` | 文档相对链接检查：README、AGENTS、docs 与项目 skill |
| `scripts/sync_version.py` | 把 `VERSION` 同步到各 package 元数据 |
| `scripts/build.py` | 发布构建，产物在 `dist/omora-<version>.zip` |
| `scripts/commit_msg.py` | 提交信息校验，由 `commit-msg` 钩子调用 |

---
name: omora-project
description: Omora 仓库的开发规范与操作手册。任务落在 Omora 仓库内——改内核（Python）、渲染引擎（TS）、插件、协议、目录结构或文档——就先读这个 skill。典型触发：加插件、这段代码放哪、内核边界怎么守、协议怎么改、文档该写哪。即使任务看起来很小，也不要跳过。
---

# Omora 项目规范

这是操作手册，不是架构文档的副本。权威顺序：`docs/ARCHITECTURE.md` > 本 skill > 个人偏好。冲突时以文档为准，并顺手改本 skill。

## 30 秒上手

1. 先读 `../../../docs/ARCHITECTURE.md`。
2. 确认改动落在哪一侧：内核 / 系统插件 / 渲染引擎（/ 运行后插件）。
3. 动手前说清楚：改什么、为什么、怎么验证。
4. 交付报告四项：改了什么 / 为什么 / 怎么验证 / 什么没验证。

## 硬规则

| 规则 | 违反了长什么样 |
|---|---|
| 内核只认插件 | 内核里出现清单、能力、槽位、依赖图 |
| 内核不碰 UI | 内核校验节点树、认组件名 |
| 内核零领域词 | 灵感 / 项目 / 需求出现在内核里 |
| 插件不 import 内核 | 插件直接 import 内核模块 |
| 插件之间只靠服务名 | A 插件 import B 插件 |
| 文档是事实来源 | 代码和 `docs/ARCHITECTURE.md` 对不上还不动文档 |

## 代码放哪

| 要写的东西 | 位置 | 语言 |
|---|---|---|
| 内核：插件加载、服务、消息转发 | `app/core/`（omora-core） | Python |
| 插件 API（SDK）：Context / Plugin / UI 节点 / 协议 | `app/sdk/`（omora-sdk） | Python |
| 系统插件：服务或页面（store / media / ui / ideas ...） | `app/packages/<name>/`（omora-plugin-*） | Python |
| 渲染引擎：组件注册表、槽位、事件 | `app/ui-engine/` | TS |
| 运行后插件（生态） | 待定 | 待定 |
| 架构与事实来源 | `docs/` | — |

产出页面不是分类轴：系统插件都可能产出页面。运行后插件的目录和格式还没定。

## 常见任务

### 加一个系统插件

1. 在 `app/packages/<name>/` 建目录：`pyproject.toml`（name / version / description / dependencies / entry point）、`src/omora/plugins/<name>/`、`tests/`。
2. 入口点写在 pyproject：`[project.entry-points."omora.plugins"] <name> = "omora.plugins.<name>:<Class>"`；依赖 `omora-sdk`；版本由 `scripts/sync_version.py` 同步。
3. 只依赖插件 API（`omora.sdk`）；用 `provide` 登记服务，需要页面就 `ui.page`。
4. 把名字加进 `app/main.py` 的 `SYSTEM_PLUGINS` 和 `config.ini` 的段。
5. `uv sync` 让它进 workspace；写行为测试：装上能跑、卸了干净、按名字取得到。

### 加一个运行后插件

目录和格式待定；定了再动。

### 改协议

协议只有一份，两种语言各写一遍，用跨语言测试钉住。内核不解析 UI 数据。

### 改文档

`docs/ARCHITECTURE.md` 是事实来源。先改文档，再改代码。

## 什么时候更新本 skill

- 目录结构或依赖方向变了；
- 同一条规则被绕两次以上；
- 新增了测试、提交以外的约定。

## 参考

- `../../../docs/ARCHITECTURE.md` —— 事实来源
- `references/traps.md` —— 已知反模式
- 测试：`.agents/skills/omora-testing/SKILL.md`
- 提交：`.agents/skills/omora-git/SKILL.md`
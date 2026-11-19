---
name: omora-project
description: Omora 仓库的开发规范与操作手册。任务落在 Omora 仓库内——改内核（Python）、渲染引擎（TS）、插件、协议、目录结构或文档——就先读这个 skill。典型触发：加插件、这段代码放哪、内核边界怎么守、协议怎么改、文档该写哪、要不要自己造轮子或引依赖。即使任务看起来很小，也不要跳过。
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
| 系统插件：服务或页面（store / media / ui / ideas ...） | `packages/<name>/`（omora-plugin-*） | Python |
| 渲染引擎 + 桌面壳：组件注册表、槽位、事件；Electron 主进程在 `shell/` | `app/ui-engine/` | TS / JS |
| 运行后插件（生态） | 待定 | 待定 |
| 架构与事实来源 | `docs/` | — |

产出页面不是分类轴：系统插件都可能产出页面。运行后插件的目录和格式还没定。

## 依赖：默认买，自写要举证

四档，按顺序选：**平台 → 库 → vendor / fork → 自写**。

| 档 | 什么时候用 | 例子 |
|---|---|---|
| 平台 | 浏览器 / Electron / 标准库已有，语义够 | `<dialog>` + `inert`、`popover`、View Transitions、`Intl`、`sqlite3`、`websockets` |
| 库 | 能力标准、核心循环不跟我们的约定打架 | 虚拟列表、浮层定位、focus-trap、Zag 状态机、i18n、打包 |
| vendor / fork | 结构对、API 改不动，适配层回答不了几个边界问题 | 少见，先证明适配层不行 |
| 自写 | 语义是我们定义的，买回来会退化成通用模型 | 文档模型、身份、ops、链接期组合、诊断 |

规则：

1. **默认买。** 新模块超过 200 行且存在成熟实现，先写“为什么不用 X”再继续。
2. **能包一层就包一层。** 改 vendored 源码的每一行，都是以后合上游的冲突源。
3. **净删才算赢。** 替换后行数没降、适配层更厚，就先不换。
4. **论文五样不买**：文档、身份、ops、链接、诊断。
5. **Python 同一套**：有库用库，能改 API 就改 API，改不动再 vendor。

### vendor 的账本

vendor 放 `app/ui-engine/vendor/<name>/` 或 `packages/<pkg>/vendor/`，目录里必须有：

- `UPSTREAM.md`：上游仓库、commit、取用日期、为什么 vendor、改了哪些文件；
- 原始 `LICENSE`（有 `NOTICE` 就一起）；
- 改动集中在少数文件，用 `PATCH` 注释标出。

优先 `git subtree`（保留历史、单一工作树），不要 submodule（HEAD 分离，容易在主仓库外迷路）。不做“纯拷源码不留出处”——那是版权上最脆弱的一种。

### 上游追踪

- 不相关的上游变更：不管。
- 修复 / 安全 / 边界补丁：评估后择优合入。
- 靠脚本不靠记忆：定期对比上游 commit 与本地文件；第一个 vendor 记 `UPSTREAM.md` 就够，出现第二个再上脚本。

## 常见任务

### 加一个系统插件

1. 在 `packages/<name>/` 建目录：`pyproject.toml`（name / version / description / dependencies / entry point）、`omora/<name>.py`、`tests/`。
2. 入口点写在 pyproject：`[project.entry-points."omora.plugins"] <name> = "omora.<name>:<Class>"`；依赖 `omora-sdk`；版本由 `scripts/sync_version.py` 同步。
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
- 新增了测试、提交以外的约定；
- 引入 / 替换依赖，或 vendor 了上游代码。

## 参考

- `../../../docs/ARCHITECTURE.md` —— 事实来源
- `references/traps.md` —— 已知反模式
- 测试：`.agents/skills/omora-testing/SKILL.md`
- 提交：`.agents/skills/omora-git/SKILL.md`
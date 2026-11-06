---
name: omora-project
description: Omora 仓库的开发规范与操作手册。只要任务落在 Omora 仓库内——改内核（Python）、渲染层（TypeScript）、C1/C2/C3 契约、官方插件、scripts/check.py 门禁、budget.json 体量预算、版本策略或 ADR——就先读这个 skill。典型触发：加插件、接 RPC、门禁红了、这段代码放哪、要不要写 ADR、预算超了、架构该怎么改。即使任务看起来很小，也不要跳过。
---

# Omora 项目规范

这是本仓库的**操作手册**，不是架构文档的副本。权威顺序：

1. `docs/` 下的架构与 ADR 是事实来源；
2. 本 skill 是操作地图、检查清单与红线；
3. 两者冲突时以 `docs/` 为准，并顺手修正本 skill。

## 30 秒上手

1. 看 `../../../docs/README.md` 的索引，按任务挑文档。
2. 动手前读 `../../../docs/engineering/discipline.md`：门禁、预算、完成定义。
3. 交付前跑 `uv run python scripts/check.py`，必须全绿。
4. 报告必须含四项：改了什么 / 为什么 / 怎么验证 / 什么没验证。

## 五条硬规则

| 规则 | 为什么 | 机器怎么拦 |
|---|---|---|
| 内核零领域词汇 | 出现 Idea / Project / Kanban 就是边界破了 | `budget.python` + 架构测试 |
| 官方功能无后门 | 官方插件只依赖 `omora_sdk` | import-linter |
| UI 是数据 | 插件产出声明式节点树，不碰 DOM / CSS | C3 校验 + 代码评审 |
| 内核是唯一真相源 | 命令上行、事件下行、UI 只是投影 | C1 设计约束 |
| 预算超了就拆 | 上帝组件 / 上帝对象用预算拦 | `budget.files` / eslint |

## 代码放哪

| 要写的东西 | 位置 | 依赖约束 |
|---|---|---|
| 领域逻辑、存储、事件、权限、插件宿主 | `kernel/src/omora_kernel/` | 标准库优先 |
| 插件可用的类型与能力声明 | `sdk/src/omora_sdk/` | 不依赖任何内部包 |
| 官方功能（灵感、项目、Git 同步…） | `plugins/<name>/` | 只能依赖 `omora_sdk` |
| 界面、渲染器、槽位 | `web/src/` | 只能经 `rpc/` 访问内核 |
| 契约 | `protocol/` | schema 是唯一真相 |
| 门禁与工具 | `scripts/` | 不写业务逻辑 |

## 常见任务

### 加一个官方功能

1. 在 `plugins/<name>/` 建独立包，`dependencies` 只写 `omora-sdk`。
2. 用 C2 注册命令与槽位，用 C3 产出节点树。
3. 写测试，跑门禁，确认 import-linter 没报。
4. 如果发现必须 import 内核才能实现——**不要开洞**，先补 SDK 能力并记 ADR。

### 改契约

三件套一起做：`protocol/` schema、生成物、changelog 的 contract 段。
破坏性变更先写 ADR；主版本号只用于契约破坏。

### 门禁红了

按 stage 名定位：

- `hygiene.*`：仓库卫生（冲突标记、未完成标记、链接、版本一致性、密钥）。
- `budget.*`：体量超预算，拆代码，不改预算。
- `py.lint` / `py.types`：代码问题，不要加 ignore。
- `py.arch`：导入边界破了，先看是不是把功能放错了层。
- `web.*`：前端工具链或边界规则。

## 什么时候必须更新本 skill

- 新增或废弃 ADR；
- 门禁新增阶段、预算调整；
- 目录结构或依赖方向变化；
- 契约版本策略变化；
- 同一条规则被绕过两次以上（说明 skill 没写清楚）；
- 每季度回看一次。

更新后必须跑门禁，并确认 skill 里的链接仍然有效。

## 参考文件

- `references/architecture.md` —— 分层、契约、信任模型、数据流
- `references/workflow.md` —— 门禁阶段、预算、完成定义、提交规范
- `references/traps.md` —— 已知反模式与真实翻车

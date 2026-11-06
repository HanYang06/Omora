# Omora 文档

> Omora 是当前代号，暂不对外定名。

Omora 是一个把「灵感」与「项目」连成一条线的本地优先工具：随手捕捉灵感、管理灵感，并让灵感与项目、需求、任务之间形成可追溯的关联。默认在本地运行，也可部署为服务器；能力由插件扩展，秉持「一切皆插件」。

## 建议阅读顺序

1. [架构总览](architecture/overview.md) —— 先建立全貌
2. [三份契约](architecture/contracts.md) —— 这是整个产品的核心资产
3. [核心边界](architecture/core-surface.md) —— 写任何代码之前先看
4. [P0 计划](roadmap/p0.md) —— 现在要动手的部分
5. [工程纪律](engineering/discipline.md) —— 动手前必读：门禁、架构测试、完成定义

## 文档索引

| 文档 | 作用 | 状态 |
|---|---|---|
| [architecture/overview.md](architecture/overview.md) | 分层、数据流、部署形态、信任分层 | 草稿 |
| [architecture/contracts.md](architecture/contracts.md) | C1 / C2 / C3 契约与版本规则 | 草稿 |
| [architecture/core-surface.md](architecture/core-surface.md) | 核心能力、准入规则、反腐蚀清单 | 草稿 |
| [engineering/discipline.md](engineering/discipline.md) | 工程纪律：门禁、架构测试、完成定义 | 已定 |
| [engineering/dependencies.md](engineering/dependencies.md) | 依赖登记与引入理由 | 已定 |
| [decisions/0001-stack-and-runtime.md](decisions/0001-stack-and-runtime.md) | ADR：Python 内核 + TS 渲染层 | 已接受 |
| [decisions/0002-core-boundary.md](decisions/0002-core-boundary.md) | ADR：核心与插件的边界 | 已接受 |
| [decisions/0003-unified-versioning.md](decisions/0003-unified-versioning.md) | ADR：统一版本发布 | 已接受 |
| [roadmap/p0.md](roadmap/p0.md) | P0 垂直切片：模块、目录、验收 | 计划 |

## 文档约定

- 文档不写版本号。历史由 git 承担，有效性由状态承担。
- 状态只有三种：草稿 / 已接受 / 已废弃（废弃时必须写明被哪份 ADR 取代）。
- 仓库内所有包（内核、前端、协议、官方插件）同号发布；兼容性由语义化版本规则承载。详见 [ADR-0003](decisions/0003-unified-versioning.md)。

## 决策状态

| 决策 | 状态 |
|---|---|
| 内核 Python，前端 TypeScript | 已定 |
| 三层契约 C1 / C2 / C3 | 已定 |
| UI 贡献是数据，UI 插件不占进程 | 已定 |
| 本地 SQLite 为规范主副本 + 事件日志 | 已定 |
| 核心边界与三道测试 | 已定 |
| 官方功能无后门 | 已定 |
| 统一版本发布（仓库内所有包同号） | 已定 |
| 工程纪律与门禁 | 已定 |
| 插件默认 Python，异语言走进程 / WASM | 已定 |
| 桌面壳（Electron vs Tauri） | 待定，P0 不做 |
| 服务器是否多租户 | 待定 |
| 项目管理深度 | 待定 |
| 渲染框架（React 暂定） | 待定 |
| 插件包格式与签名 | 待定，P2 |
| 同步与冲突策略 | 待定 |
| 移动端技术 | 待定 |

## 术语

| 词 | 含义 |
|---|---|
| 内核 Kernel | Python 侧最小运行时：引导、信任、契约、状态原语 |
| 渲染器 Renderer | TS 侧声明式 UI 运行时：节点树 → 界面 |
| C1 | 内核与前端之间的私有 RPC |
| C2 | 宿主与插件之间的公开 RPC |
| C3 | 插件与渲染器之间的 UI 数据 ABI |
| 槽位 Slot | 界面预定义区域，插件往里填充 |
| 能力 Capability | 内核授予插件的原语权限 |
| 服务 Service | 插件提供给其他插件的功能，经服务注册表路由 |
| 官方插件 | 与第三方插件走同一套 API、无后门的随附插件 |

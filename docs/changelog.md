# 更新日志

> 只记已经完成、可验证的变化。方向在 [路线图](roadmap.md)，未完成在 [TODO](todo.md)。

## 2026-11-18

- **架构定论**：ADR-0004 确立「静态结构 + 最小节点更新」为目标架构，V1 分阶段接管默认入口；ADR-0003 被取代。新增 [项目现状](planning/state-of-project.md)、[V1 树](planning/v1-tree.md)、[决策机制](planning/decision-process.md)；路线图改为现期 / 近期 / 长期 / 展望，TODO 按新阶段重排。
- **文档口径统一**：README / AGENTS / ARCHITECTURE / engine README / migration 对 V1 的定位统一为「目标架构、分阶段接管」；S7 剩余项归为非核心。
- **V1 树契约**：`schema/tree/tree.schema.json` 成为 `dendro.tree/1` 唯一来源；Python/TS 校验、生成类型、共享正负例、CI 漂移检查（#114）。
- **SDK node scope**：`omora.scope/1` 契约；Python/TS 的 Node/Host/Request/Capability/生命周期、move/clone/unmount/dispose；CI 类型与行为测试（#115）。
- **Page/State/When/Bind**：`omora.page/1` 契约；Python/TS Page 层、When 稳定容器、Bind 单向、Action/节点事件；旧 Slot 未接（#117）。
- **Build-time composer**：V1 document + partial `mode:new`、稳定挂载、`E-COLLISION` / `E-PARENT-MISSING` / `E-TREE-CHAIN` 原子诊断；未接 Vite（#116）。
- **Engine runtime mount**：V1 document → host/renderer registry；mount/replace/unmount/dispose、失败回滚；未接 app（#118）。
- **安全例外**：picomatch `GHSA-fc5q-39xc-vjpf` 为 dev-only、无 patched 版本，临时 ignore，2026-12-31 复审（#119）。

## 2026-11-15

- Dendrolink Slot 主会话成为默认入口；启动骨架由 Slot 链接编译；legacy 快照路径删除。
- 运行后来源示例（自动发现 + 热更新，S7.1）落地；S7.2/S7.3 仍未做。

## 2026-11-13

- Slot 文档运行时核心：三张索引、原子 ops、集合模板、data router、标量绑定、session/route。
- EngineRuntime / DocumentView / 权限薄层 / SourceHost / 审计；Slot 文档经薄桥渲染 DOM。

## 2026-11-11

- 灵感页三栏工作台、传统搜索、捕捉工作区（就地展开、录了即存、波形/命名）。
- store 通用化、插件管理器、media/audio/video 拆分、uv workspace 化。

## 2026-11-10

- Python 插件 + TS 渲染引擎的最小闭环：插件 → Slot 节点 → 界面 → 事件 → 插件。

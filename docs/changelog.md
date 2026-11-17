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
- **V1 构建产物**：`scripts/static_tree.py` 把系统插件页面升成 V1 输入；Vite 构建期 compose 成每页一份 `dendro.tree/1` 文档 + manifest，落在 `dist/tree/`（ideas 5.4 kB / plugins 10.9 kB）；`scripts/tree_artifacts.py` 用 Python 语义复验产物。运行时尚未接入。
- **V1 集合字段**：`dendro.tree/1` 节点增加 `collection`（`source` / `key` / `select` / `templates`）；模板子树参与身份校验、不可作挂载目标，组合器报 `E-COLLISION` / `E-PARENT-MISSING`。运行期实例化未接。
- **V1 kind 门禁**：`treeKinds` 成为 V1 kind 词表（legacy 词表 + `app` + `page-link`）；构建期组合后逐节点查存在性（含 `collection.templates`），未知 kind 报 `E-TREE-KIND` 并让构建失败。当前四个真实页面全部通过。
- **V1 DOM 运行时**：`TreeRuntime` 接上 DOM 宿主与 `Kind` 适配器——组件不重写，只换协调层。真实 ideas 空态在 jsdom 里挂出 app / 4 条导航 / 页面文案；`collection` 实例化与 `data` op 未接。
- **V1 产物消费**：`?engine=tree` 读 `/tree/manifest.json` + 页面文档挂载；dev 由 Vite middleware 现算同一批产物，`vite preview` / 部署读 `dist/tree/`。导航仍禁用（静态产物没有 handler）。
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

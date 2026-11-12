# ADR-0002：移除 React，渲染层直写 DOM

- **状态**：已接受（2026-11-13）
- **决策者**：项目作者 + Lead
- **相关**：[README](../README.md)、[renderer.md](../renderer.md)、迁移计划

## 背景

引擎最初是一个 React 组件渲染器，React 提供组件编写、hooks、协调与生态。现在它正在变成 **UI 文档运行时**：引擎自己拥有 Slot 身份、更新、生命周期与信息流。此时 React 不再是渲染细节，而是引擎里的**第二个 runtime**，两套模型需要靠胶水对齐：

- `withEventProps` 让 React 读懂引擎的 events；
- 用 Node id 当 React key，让 React 协调对齐引擎身份；
- memo / 引用保持，求 React 不要重渲染引擎没变的节点；
- diff 额外兼容节点级新字段，避免 v1 补丁把 id/events 丢掉。

同时组件数量是固定成本：不管有没有 React，引擎都要为 38 个 kind 写原生实现，否则树发过来没人认识。React 并没有省掉这批组件，只多出一整套“node → props/state/hooks → React element → DOM”的翻译。

Vite 侧同理：现在 Vite 编译的是 JSX → `React.createElement`，引擎自己的静态骨架仍是运行时由 React 解释。去掉 React 后，Vite 可以编译引擎自己的东西（静态骨架 → DOM/HTML、kind 实现 → DOM 操作）。

## 决定

1. **移除 React**（`react`、`react-dom`、`@vitejs/plugin-react`、React 类型与测试渲染器）；不保留 React adapter、不做长期共存。
2. 渲染层是 **DOM 原生 renderer**：`kind → DOM`，`node.id → element`，更新按节点身份直接落 DOM。
3. 组件词表固定在引擎里：38 个 kind = 38 个 DOM 实现 + 统一 `Kind` 接口。
4. Vite 保留为构建/dev 工具，但不再承担 React 编译；静态骨架的编译接入放在第二阶段。
5. React 文件在 DOM renderer 对齐现有行为后删除；删除前不并行维护两套渲染实现。

## 分两步

1. **DOM renderer 对齐**：核心 renderer + 38 个 kind + 测试；删除 React 依赖与 React 测试基建；行为与现有 v1 对齐。
2. **编译接入 Vite**：静态骨架编译成 DOM/HTML；Vite 插件运行引擎的 compiler（核心逻辑留在引擎内，Vite 只是 adapter）。

## 后果

**得到**：

- 一个 runtime、一套身份/更新/生命周期；不再有翻译层。
- 更新直接落 DOM，patch 的语义第一次真正兑现。
- 引擎可独立发布：DOM renderer 是默认后端，不绑 React；Vite 只是开发工具。
- 静态结构可在构建期编译，首帧不必等 JS 渲染树。

**要自己负责**：

- DOM 生命周期（mount/update/destroy）、事件、局部状态、清理账本；
- 输入框焦点/IME/selection、列表 move、表单原生行为、可访问性；
- 错误隔离与未知 kind 降级；
- 测试从 React 渲染器切到原生 DOM（jsdom/happy-dom）。

**风险与缓解**：

- 焦点/IME：只改必要属性，聚焦中不重写 value；用真实 DOM 测试覆盖。
- 事件/清理：所有登记进 runtime 的卸载账本；每个 kind 的 destroy 有行为测试。
- 回归面大：按组件组并行迁移，集成分支逐组对齐，最后一次性删 React。
- 开发体验：失去 React DevTools；用引擎 diagnostics/浏览器 DOM 面板替代。

## 被否掉的方案

- **React 降级为纯视图**：仍保留两套协调与订阅 glue，问题只是变轻。
- **Preact/Solid 等轻框架**：只减体积，不减模型重复。
- **长期双渲染后端**：维护两套行为，违背“一个 runtime”。

## 验收

- 38 个 kind 全部有 DOM 实现与行为测试；React 依赖与 React 文件删除。
- 现有页面（灵感页三栏、搜索、捕捉、设置）在 DOM renderer 下行为一致。
- 本地门禁全绿；CI 全绿后再合并。

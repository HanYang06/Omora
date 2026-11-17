# 路线图

> 这里只写**方向、阶段与退出条件**。完成记录在 [changelog](changelog.md)，当前未完成工作在 [TODO](todo.md)。路线图不是 changelog。

## 0. 当前基线

旧 Slot 主会话（`dendro.ui/1`）仍是默认运行路径；V1 树（`dendro.tree/1`）的契约、Python/TS 校验、node scope、Page/State/When/Bind、build-time composer、runtime mount 已作为独立模块落地，但**还没接主入口**。

所以当前阶段的目标不是“再加一个功能”，而是把 V1 从“可测核心”变成“真实页面能跑、旧 Slot 能退”的运行路径。

## 1. 当前阶段：V1 树接管主会话

### 1.1 会合点

- **Serializer + component catalog**：Page/Node 稳定产出 `dendro.tree/1`；组件 kind/props/events 单一来源，Python/TS 生成/消费同一份词表。
- **Build gate**：`assertTreeComposes` 接 Vite `buildStart`；partial 冲突、错链、父不存在在构建期失败。
- **Engine bridge**：compose 的 document 交给 `TreeRuntime`，页面/导航/切换先跑通。
- **Ideas 竖切**：用真实搜索、列表、捕捉节点写一页 V1，挂在 `?engine=v1` 后面；旧 Slot 默认不变。

### 1.2 退出条件

- 同一份 ideas 页面在 V1 下可渲染、可点击、可更新；
- 旧 Slot 仍能回退，CI 同时覆盖两条路径；
- build gate 能在 CI 中复现一个真实冲突；
- 文档明确“V1 未接管默认入口”，不把目标写成现状。

## 2. 下一阶段：旧 Slot 退休

- SourceHost / page / session / route / data router / collection / 三级更新接到 V1；
- 真实 component registry/DOM 渲染接 V1 kind；
- ideas / projects / requirements / plugins 逐页迁移；
- 权限薄层、overlay、rules/reactions 按现有契约补齐；
- 删除 `dendro.ui/1` 与旧 Slot 路径，统一文档、fixture、测试。

**退出条件**：默认入口只走 V1；旧 Slot 删除；全量 CI 与 smoke 绿；没有“两套树”并行。

## 3. Dendrolink 完整形态

- 运行后来源的网络帧 / worker 来源 / 订阅 / 媒体登记（S7.2）；
- 规则执行（`reactions`）与 schema 单一来源（S7.3）；
- 来源级权限、`observe` / `intercept`、权限审计；
- `before/after`、slot 排序策略、按 kind 的 props/events schema；
- 集合模板嵌套、窗口化与坏条目隔离；
- 完整寻址 / 增量索引 / 跨父 move 的边界收口。

## 4. 产品能力（不阻塞 V1）

- 手机当摄像头（Android 客户端，绕开浏览器安全上下文）；
- 摄像头档位自适应；
- 本地转写（Whisper）与 AI 接口插件；
- 灵感关联 / 网、GitHub provider；
- 深色主题、窄屏、TS 插件宿主、房间、server 形态。

## 5. 非目标 / 暂缓

- React 式函数组件、hooks、JSX、隐式重跑；
- 为“以后可能”先造通用框架；
- 在没有真实页面验证前扩组件词表；
- 用版本号给系统插件单独发版。

## 6. 关联

- 当前队列：[TODO](todo.md)
- 完成记录：[changelog](changelog.md)
- 引擎现状与缺口：[engine/README.md](engine/README.md) §6
- 迁移记录：[engine/migration.md](engine/migration.md)

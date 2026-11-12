# 迁移：v1 → Dendrolink

> 状态：**提议**（随实现逐阶段转正）。
> 依赖：[README](README.md) · [runtime.md](runtime.md) · [wire.md](wire.md)
> 相关：[docs/planning/change-program.md](../planning/change-program.md)（仓库结构迁移，已合并）

## 0. 原则

1. 先文档、再兼容层、最后清理；每个阶段都能单独回滚。
2. 一个阶段 = 一个 PR；实现 + 测试 + 文档同 PR。
3. 代码与旧文档冲突时，以本系列“目标契约”为方向、以当前代码为现状，不把未实现写成事实。
4. 不追求一次迁移 38 个组件；先用一个真实页面把契约走通。

## 1. 阶段

| 阶段 | 内容                                                       | 退出条件                          |
| ---- | ---------------------------------------------------------- | --------------------------------- |
| S0   | 仓库结构迁移、引擎文档系列、旧文档退役                     | 工作区干净；CI 绿；文档链接通过   |
| S1   | schema 单一来源；Python 序列化产出 Slot v2；跨语言 fixture | 同一 fixture 两侧结论一致         |
| S2   | 编译/链接：诊断码、顺序模型、静态骨架编译门禁              | 冲突在 CI 可复现；死引用/歧义必报 |
| S3   | 三张索引 + 三种更新 + 集合绑定；灵感页 spike               | 数据更新不重挂；换页协调正确      |
| S4   | 权限薄层 + 生命周期账本 + 观测指标                         | 越权拒绝；卸载零残留；有指标      |
| S5   | TS 宿主 / 组件命名空间 / 运行后来源                        | 示例来源不改引擎源码即可加界面    |

> S1.1 进度（2026-11-13）：已落 `app/sdk/omora/sdk/document.py`（类型）+ `document_io.py`（校验/序列化）与 `app/ui-engine/src/core/document.ts` 的 v2 Slot/Document 契约，以及共享 fixture `app/sdk/tests/fixtures/document.json`；尚未接入运行时。

## 2. 兼容策略

- **v1.5 加字段**：节点允许新增 `id / events / layout / reactions / collection / grant`，旧 `{type, props, children}` 仍可读；渲染器优先新字段，回退旧路径。
- **双读窗口**：S1–S3 期间新旧序列化并行，fixture 同时覆盖；S4 后删除旧路径。
- **全量兜底**：迁移期协议允许新引擎向旧客户端发全量；不做长期双协议。
- **命名空间迁移**：`omora.ui/2` / `omora:*` / `om.*` → `dendro.ui/2` / `dendro:*` / `dendro.*`；在 S1 一次性换掉，fixture 与生成物同步。

## 3. 代码迁移映射

| 现在                                      | 目标                         | 阶段  |
| ----------------------------------------- | ---------------------------- | ----- |
| `app/sdk/omora/sdk/ui.py` / `controls.py` | Slot 词表 + schema 源        | S1    |
| `packages/ui/omora/ui.py`                 | 文档/局部树注册 + 数据路由   | S2–S3 |
| `packages/ui/omora/_diff.py`              | 文档增量（按 id）或删除      | S3    |
| `app/ui-engine/src/app.tsx`               | Session + 运行时容器         | S3    |
| `render/compose.ts`                       | Compiler/Linker              | S2    |
| `render/patch.ts`                         | Document 更新管线            | S3    |
| `render/renderer.tsx` / `components.tsx`  | Renderer + schema 生成注册表 | S1–S3 |
| `scripts/static_ui.py`                    | 构建期编译门禁               | S2    |
| `scripts/keys.py` / generated             | slot id 生成器               | S1    |

## 4. 旧文档去向

| 旧文档                               | 去向                                         |
| ------------------------------------ | -------------------------------------------- |
| `docs/design/ui-engine.md`           | 节点/流程并入 runtime/components/wire 后删除 |
| `docs/design/ui-plugins.md`          | 键/贡献并入 addressing/composition 后删除    |
| `docs/design/ui-engine-subsystem.md` | 归档到 `docs/engine/archive/`（已退役）      |
| `docs/design/ui-tree.md`（草案）     | 已拆入本系列后删除                           |

## 5. 风险与回滚

- **协议形状变化**：S1 起新旧字段并存；回滚只需停用新字段读取。
- **组件迁移遗漏**：以 fixture + 渲染测试兜底；每迁一组组件补一组行为测试。
- **性能退化**：S3 建立与 v1 的对照基线；组合/补丁指标进 CI 报告。
- **过渡期文档失真**：所有未实现条目保持“已定未实现”，不写成现状。

## 6. 未决

- S1 的 schema 描述语言；
- v1.5 双读窗口要持续几个 PR；
- 何时允许删除旧序列化路径；
- 运行后来源与 TS 宿主是否放在同一轮。

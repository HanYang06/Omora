# 分层与依赖方向

> 状态：**决定已定**；契约层 `src/contract/` 与 engine / host 分层（阶段 1–2）已落，其余层按阶段迁移。
> 相关：[README](README.md) · [renderer.md](renderer.md) · [components.md](components.md) · [migration.md](migration.md)

## 0. 一句话

引擎按**依赖方向**分层，不按“文件类型”分：契约 → 链接 → 文档/集合算法 → 宿主 → 渲染/组件 → 应用。越底层越不知道上层；组件、渲染、链接、集合算法、宿主各有各的家，不许互相串门。

## 1. 为什么

前端文件多，目录不治理会越来越懵。当前问题不是“文件多”，而是**层混在一起**：

- `dom/` 一万多行里同时有 app 入口、壳、renderer、38+ 个组件、Slot 桥、预览；
- `runtime/` 曾同时有文档/集合算法、宿主设施（权限/账本/审计/指标/来源）、编排（EngineRuntime）——已拆成 `engine/` 与 `host/`；
- `core/` 曾同时有契约（Slot/Document）与连接/日志/设备上报（契约已抽出，其余待归位）；
- `link/` 曾反向依赖权限模块（已移到 `contract/policy`）；`host/engine` 曾依赖 `dom/renderer` 的统计类型（已移到 `contract/render`）；
- 旧快照渲染还在 `render/`，但没有和 Slot 路径显式隔离。

## 2. 目标结构

```text
app/ui-engine/src/
  contract/      契约：Slot/Document、schema、诊断码、权限策略、渲染统计；无 DOM、无算法
  link/          编译/链接器：局部树 → 权威根树 + 诊断；只依赖 contract
  engine/
    document/    文档状态、三张索引、ops、route/session
    collections/ 集合模板实例化、keyed reconcile
    updates/     data router、绑定、水合
  host/          来源宿主、EngineRuntime/SourceEngine、权限、生命周期账本、审计、指标
  renderer/      DOM renderer、Kind 契约、Slot → 渲染节点桥；不含组件
  components/    38+ 个 kind 实现、注册表、图标；只依赖 contract + renderer 类型
  app/           入口、连接、壳、会话装配
  legacy/        旧快照渲染路径（隔离，迁移结束删除）
  build/         Vite 插件、启动骨架编译 host（adapter）
  platform/      media / capture / search 等宿主工具
  generated/  styles/
```

当前进度：

- [x] schema 重置为 `dendro.ui/1`、去掉 v1/v2 版本叙事（PR #75）
- [x] `dom/kinds` + registry + icons 拆成顶层 `components/`（PR #76）
- [x] 契约层 `src/contract/` 抽取（document / diagnostics / policy / render），修掉倒置 1、2
- [x] `runtime/` 拆成 `engine/`（document / collections / updates）与 `host/` 设施
- [ ] `dom/` 拆成 renderer、Slot 桥、app 入口、shell
- [ ] `render/` 隔离成 legacy
- [ ] build / platform 归位；`app/ui-engine` 包根再评估 engine / desktop 拆分

## 3. 依赖规则

只允许箭头方向：`contract → link → engine.* → host → renderer/components → app`；`build` 是 adapter，可以依赖 renderer/components，但不被运行时依赖；`legacy` 只允许 app 引用。

| 层            | 可以依赖                                         | 禁止                              |
| ------------- | ------------------------------------------------ | --------------------------------- |
| `contract/`   | 无（纯类型/纯函数）                              | DOM、renderer、engine、host、app  |
| `link/`       | contract                                         | engine/host、DOM、app             |
| `engine/*`    | contract、link 的输出                            | DOM、renderer、host、app          |
| `host/`       | contract、link、engine                           | renderer/DOM、app                 |
| `renderer/`   | contract                                         | engine、link、host、app           |
| `components/` | contract、renderer 类型、platform 工具（只读）   | engine、link、host、app、DOM 状态 |
| `app/`        | 全部（组合根）                                   | 被下层反向 import                 |
| `legacy/`     | contract、renderer                               | engine、host、app（只给 app 用）  |
| `build/`      | contract、renderer、components、host（只做编译） | 被运行时 import                   |
| `platform/`   | contract                                         | DOM 组件、engine、host            |

已知要修的倒置（1、2 已修；3、4 未做）：

1. ~~`link/link.ts` → 权限模块~~：能力匹配已移到 `contract/policy`，link 与 host 都依赖它；
2. ~~`host/engine.ts` → `dom/renderer`（`RenderStats`）~~：统计类型已移到 `contract/render`，engine 不依赖渲染实现；
3. `compiler/` → `dom/shell`：构建期编译器是 adapter，迁到 `build/` 后依赖 renderer 是允许的；
4. `core/device-report.ts` → `capture/devices`：`core` 不再当“杂物间”，设备上报移到 platform/app 侧。

本轮另把 `runtime/` 拆成 `engine/`（document / collections / updates）与 `host/`，并把权限检查从
ops / data / session 改成 host 注入的 guard：engine 层只认 guard，不再 import host。

## 4. 迁移方式

- **一个 PR 只搬一层**，不改行为、不改 schema、不调预算；测试数与行为测试保持。
- 先抽契约与策略（收益最大、冲突最小），再拆 runtime，再拆 dom/legacy，最后 build/platform。
- 过渡期可以用 re-export shim，但一个层搬完后 shim 必须删。
- 每步加 eslint `no-restricted-imports` 边界规则，让倒置在 CI 里直接红，而不是靠 review 记性。
- 目录搬动后同步 renderer.md / components.md / AGENTS 结构表；预算与链接检查照常跑。

## 5. 非目标

- 不做一次性大搬家；不为了目录好看改行为。
- 不把组件塞回 renderer，也不把宿主策略塞进链接器。
- 不把 `app/ui-engine` 包根拆成多个包，除非 engine / desktop 边界真的稳定。

## 6. 待定

- `Kind` 契约最终放 `renderer/types` 还是 `contract`；
- `platform/` 与 app 的边界（媒体/捕获是否算宿主能力）；
- `build/` 与 renderer 的 adapter 契约是否要单独文档。

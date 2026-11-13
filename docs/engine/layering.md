# 分层与依赖方向

> 状态：**决定已定**；六个阶段全部完成（contract / link / engine / host / renderer / components / app / legacy / build / platform）。
> 相关：[README](README.md) · [renderer.md](renderer.md) · [components.md](components.md) · [migration.md](migration.md)

## 0. 一句话

引擎按**依赖方向**分层，不按“文件类型”分：契约 → 链接 → 文档/集合算法 → 宿主 → 渲染/组件 → 应用。越底层越不知道上层；组件、渲染、链接、集合算法、宿主各有各的家，不许互相串门。

## 1. 为什么

前端文件多，目录不治理会越来越懵。当前问题不是“文件多”，而是**层混在一起**：

- `dom/` 曾同时有 app 入口、壳、renderer、38+ 个组件、Slot 桥、预览——已拆成 `renderer/`、`components/`、`app/`；
- `runtime/` 曾同时有文档/集合算法、宿主设施（权限/账本/审计/指标/来源）、编排（EngineRuntime）——已拆成 `engine/` 与 `host/`；
- `core/` 曾同时有契约（Slot/Document）与连接/日志/设备上报（已全部归位：契约 → contract、连接/日志/topic → app、device-report → app，core/ 删除）；
- `link/` 曾反向依赖权限模块（已移到 `contract/policy`）；`host/engine` 曾依赖 `renderer/renderer` 的统计类型（已移到 `contract/render`）；
- 旧快照渲染已隔离到 `legacy/render/`：只有 app 与构建期 adapter（build）引用它。

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
  app/           入口、连接、日志、topic、会话装配、device-report
  legacy/        旧快照渲染路径（隔离：只给 app 与 build 过渡期引用，之后删除）
  build/         Vite 插件、启动骨架编译、链接期门禁（构建期 adapter）
  platform/      media / capture / search 等宿主工具
  generated/  styles/
```

当前进度：

- [x] schema 重置为 `dendro.ui/1`、去掉 v1/v2 版本叙事（PR #75）
- [x] kinds 目录 + registry + icons 拆成顶层 `components/`（PR #76）
- [x] 契约层 `src/contract/` 抽取（document / diagnostics / policy / render），修掉倒置 1、2
- [x] `runtime/` 拆成 `engine/`（document / collections / updates）与 `host/` 设施
- [x] `dom/` 拆成 `renderer/`（renderer + Kind 契约 + Slot 桥）、`components/`（Slot 原生 kind + 测试 helper）、`app/`（入口 / 壳 / 视图 / 预览 / 注册表）
- [x] 旧快照渲染（`render/`）隔离成 `legacy/render/`，只允许 app 与 compiler adapter 引用
- [x] core 契约与工具归位（protocol / media 类型 → contract，Node → renderer，快照模型 → legacy，connection / log / topics → app）
- [x] build / platform 归位（compiler → build，capture / media / search → platform，device-report → app，core/ 删除）
- [ ] `app/ui-engine` 包根再评估 engine / desktop 拆分（非目录阶段，后续）

## 3. 依赖规则

只允许箭头方向：`contract → link → engine.* → host → renderer → components → app`；`platform` 是宿主工具旁支（只依赖 contract）；`build` 是构建期 adapter（可依赖 contract / link / renderer / components / host / legacy，不被运行时依赖）；`legacy` 只允许 app 与 build 过渡期引用。

| 层            | 可以依赖                                           | 禁止                                                         |
| ------------- | -------------------------------------------------- | ------------------------------------------------------------ |
| `contract/`   | 无（纯类型/纯函数）                                | DOM、renderer、engine、host、app                             |
| `link/`       | contract                                           | engine/host、DOM、app                                        |
| `engine/*`    | contract、link 的输出                              | renderer、host、platform、app                                |
| `host/`       | contract、link、engine                             | renderer/DOM、app                                            |
| `renderer/`   | contract                                           | engine、link、host、platform、app                            |
| `components/` | contract、renderer 类型、platform 工具（只读）     | engine、link、host、app、DOM 状态                            |
| `app/`        | 全部（组合根）                                     | 被下层反向 import                                            |
| `legacy/`     | contract、renderer、components                     | engine、host、app（只给 app/build）                          |
| `build/`      | contract、link、renderer、components、host、legacy | app、engine、platform；被运行时 import                       |
| `platform/`   | contract、platform 内部                            | renderer、components、engine、host、link、legacy、app、build |

已知要修的倒置（全部已解）：

1. ~~`link/link.ts` → 权限模块~~：能力匹配已移到 `contract/policy`，link 与 host 都依赖它；
2. ~~`host/engine.ts` → `renderer/renderer`（`RenderStats`）~~：统计类型已移到 `contract/render`，engine 不依赖渲染实现；
3. ~~构建期编译器 → `app/shell`~~：已解——DomShell 随旧快照壳移到 `legacy/shell`，`build/` 只依赖 legacy，不碰 app；
4. ~~device-report → 设备检测~~：已解——device-report 移到 `app/device_report`，
   platform/capture 只被 app 与 components 使用，platform 不 import 上层；
5. `build/` → `legacy/render/`：过渡期允许的 adapter 依赖（构建期静态骨架仍用旧快照组合），
   legacy 删除时一起消失；其余目录不得 import legacy。

本轮另把 `runtime/` 拆成 `engine/`（document / collections / updates）与 `host/`，并把权限检查从
ops / data / session 改成 host 注入的 guard：engine 层只认 guard，不再 import host。

## 4. 迁移方式

- **一个 PR 只搬一层**，不改行为、不改 schema、不调预算；测试数与行为测试保持。
- 先抽契约与策略（收益最大、冲突最小），再拆 runtime，再拆渲染 / 入口，最后 build/platform 与 legacy。
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

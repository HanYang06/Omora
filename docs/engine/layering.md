# 分层与依赖方向

> 状态：**现状**（2026-11-20）。Slot 时期的分层（`engine/document`、`engine/updates`、
> `engine/collections`、`host/`、Slot link/build 模块）已随拆桥删除；
> 当前目录与依赖方向如下。
> 相关：[engine/README](README.md) · [renderer.md](renderer.md) · [components.md](components.md)

## 0. 一句话

引擎按**依赖方向**分层：契约 → 文档算法 → 组合 → 组件/渲染 → 应用；
构建期 adapter 旁挂。越底层越不知道上层。

## 1. 当前结构

```text
app/ui-engine/src/
  contract/   协议帧、tree schema 校验/生成类型、RenderStats 类型；无 DOM、无算法
  link/       构建期树组合：base + partials → 唯一文档（tree_compose）
  engine/tree/ 文档算法：ops 文档层、路径复制、原子回滚、TreeRuntime、集合原语
  components/ Kind 实现（38 个 + app / page-link / dialog / virtual-list）、注册表、图标
  renderer/   Kind / RenderContext 类型、事件解析、通用 DOM 协调器（组件单测）
  app/        入口 / 连接 / 日志 / 设备上报 / V1 宿主与渲染适配 / 预览
  build/      Vite 插件：构建期 compose 与 /tree/ 产物（dev 与 build）
  platform/   media / capture / search 等宿主工具
  sdk/        omora.scope/1 与 omora.page/1 的 TS 契约
  generated/  static-tree.json、keys.ts（生成物）
  styles/     CSS
```

## 2. 依赖规则

只允许箭头方向：`contract → link/engine → components → renderer → app`；
`build` 是构建期 adapter（可依赖 contract / link / components），不被运行时依赖；
`platform` 是宿主工具旁支（只依赖 contract，不被下层反向依赖）。

| 层             | 可以依赖                                   | 禁止                                            |
| -------------- | ------------------------------------------ | ----------------------------------------------- |
| `contract/`    | 无（纯类型 / 纯函数）                      | DOM、engine、components、app                    |
| `link/`        | contract                                   | DOM、engine、components、app                    |
| `engine/tree/` | contract                                   | DOM、components、link、app（link 是上游）       |
| `components/`  | contract、renderer 类型、platform 只读工具 | engine、link、app、DOM 状态（只在 create 里用） |
| `renderer/`    | contract                                   | engine、link、components、app                   |
| `sdk/`         | 独立（scope / page 契约）                  | 引擎内部                                        |
| `app/`         | 全部（组合根）                             | 被下层反向 import                               |
| `build/`       | contract、link、components                 | app、engine、platform；被运行时 import          |
| `platform/`    | contract、platform 内部                    | renderer、components、engine、link、app、build  |

## 3. 已知边界

- `components/` 的 DOM 协调器（`renderer/renderer.ts`）保留给组件单测；生产路径走
  `app/tree/` 的 V1 适配，不在 renderer 层。
- `app/tree/` 是唯一同时依赖 engine 与 components 的组合层。
- `build/` 不依赖 app；构建期读 `static_tree.py` 的输入，产物由单独的 Python 脚本复验。

## 4. 历史

- Slot 的 `engine/document` / `updates` / `collections` / `host`、`link` 编译器、
  `build` 启动骨架、`renderer` 的 Slot 桥与 Slot 注册表已删除；
- 删除过程与旧分层记录见 [migration.md](migration.md) 与 [changelog](../changelog.md)；
- 旧文档（contract / addressing / structure / composition / updates / runtime）保留为历史设计。

## 5. 非目标

- 不做一次性大搬家；不为了目录好看改行为。
- 不把组件塞回 renderer；不把构建期组合塞进运行时。
- 不把 `app/ui-engine` 拆成多个包，除非 engine / desktop 边界稳定。

## 6. 待定

- `Kind` 契约最终放 `renderer/types` 还是 `contract`；
- `platform/` 与 app 的边界（媒体 / 捕获是否算宿主能力）；
- `build/` 与运行时渲染适配的契约是否单独成文。

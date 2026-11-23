# 测试：分层、命令与覆盖范围

> 状态：**现状**（2026-11-20）。Slot 时期的测试随拆桥删除；现有测试全部围绕
> V1 树、插件行为与共享组件。**测试证明行为，不证明类型 / 非空 / 覆盖率数字**。
> 相关：[树运行时](tree-runtime.md) · [ops](tree-ops.md) · [构建](build.md) · [CI](../design/ci.md)

## 1. 三层

| 层         | 证明什么                                            | 位置                                  |
| ---------- | --------------------------------------------------- | ------------------------------------- |
| Python     | 内核 / 插件 / SDK / socket 端到端                   | 各 package 的 `tests/`、`app/*/tests` |
| TS 单元    | 树文档应用、运行时 patch、组件 DOM 行为、构建门禁   | `app/ui-engine/tests/`                |
| Playwright | 真浏览器里的 V1 树预览、虚拟列表、原生 dialog、a11y | `app/ui-engine/tests/visual/`         |

Python 侧当前收集 **465** 条；TS `vitest` **499** 条；Playwright **4** 条（tree 预览

- 其无障碍、virtual、dialog；默认主会话要连 Python，不在浏览器测试里跑）。

## 2. 本地命令

```bash
uv sync
pnpm install

uv run ruff check .
uv run ruff format --check .
uv run pytest --cov=app --cov=packages --cov-report=term-missing
uv run mypy -p omora.cli -p omora.core -p omora.sdk
uv run mypy -m omora.store -m omora.manager -m omora.media -m omora.ui \
  -m omora.audio -m omora.video -m omora.ideas -m omora.projects \
  -m omora.requirements -m omora.net
uv run mypy app/boot/__init__.py app/main.py app/boot/tests app/core/tests app/sdk/tests \
  packages/audio/tests packages/ideas/tests packages/manager/tests packages/media/tests \
  packages/net/tests packages/store/tests packages/ui/tests packages/video/tests

pnpm exec eslint app/ui-engine/src app/ui-engine/shell/main.cjs
pnpm exec prettier --check .
pnpm --dir app/ui-engine exec tsc --noEmit
pnpm --dir app/ui-engine exec vitest run --coverage --configLoader runner
pnpm --dir app/ui-engine exec playwright test
```

覆盖率地板：Python 95%（当前 96.9%）；TS 见 `vite.config.ts` 的 `test.coverage.thresholds`。
Playwright 本地默认用系统 Edge；CI 用 Playwright Chromium 并跳过像素比对，DOM 与 axe 照跑。

## 3. 钉住什么（按层）

### 3.1 V1 文档与 ops（`tests/engine/tree/`）

- `apply.test.ts`：版本 / 原子 / 路径复制 / `changed`、chain / id / order、
  data op 文档层（成功 / 幂等 / 过期 / 坏载荷回滚）。
- `ops.test.ts`：与 Python 共用的 `tree-ops.json` 五个 op 形状；`parseOps` 接受同一份 fixture。
- `runtime.test.ts` / `replace.test.ts` / `runtime_ops.test.ts`：`TreeRuntime` 的
  mount / replace / unmount / dispose、setProps / mount / unmount / replace 的最小 patch、
  失败回滚与元素复用。
- `view.test.ts` / `registry.test.ts`：TreeView 薄入口、渲染器注册表。

### 3.2 适配与构建（`tests/app/tree/`、`tests/build/`）

- `tree_document.test.ts`：真实 ideas 空态（`static-tree.json` → compose）挂出
  app / 4 条导航 / 页面文案。
- `tree_renderer.test.ts` / `tree_host.test.ts` / `tree_collection.test.ts`：
  Kind 适配、placement / a11y / i18n、子挂载点稳定性、collection 投影。
- `live_event.test.ts`：`ui.tree` 首帧、`ui.tree_event` 回 ops 原地 patch、
  整树回退 replace、焦点保留、`ui.changed` 推送。
- `compose.test.ts` / `artifacts.test.ts` / `vite-tree*.test.ts`：构建期 compose、
  `dist/tree/` 产物形状、dev 与 build 产物一致。
- `main.test.ts`：默认入口只有 V1 树；`?engine=tree` / `virtual` / `dialog`。

### 3.3 组件（`tests/components/`）

全部 `Kind` 的 DOM 行为：标签 / class / 属性、事件 handler id、销毁清理；
虚拟列表窗口化、原生 dialog 模态与 Esc、音频 / 视频捕获（含设备与上传规则）。
组件的通用 DOM 协调器 `renderer/renderer.ts` 保留给这批单测。

### 3.4 Python

- 内核 / SDK：插件生命周期、scope / page / when / bind 契约、协议帧。
- 插件：每个系统插件的行为（ideas 的捕捉 / 搜索 / 详情、manager 设置页、媒体通道等）。
- socket 端到端（`app/boot/tests/test_loop.py`）：真内核 + 真插件 + 真 WS 连接，
  走 `ui.tree` 首帧、`ui.tree_event` 事件、媒体 HTTP 通道与 manager 开关。
- 构建门禁：`scripts/tests/` 钉住 tree schema、静态输入、产物校验、预算、文档链接。

## 4. 已删除的 Slot 测试

随 Slot 路径删除：Slot 文档 / 链接器 / 宿主 / 数据路由 / 绑定 / 换页，
以及 `?engine=slot` 预览、Slot 启动骨架的测试与 Playwright 基线。
插件与端到端测试没有删行为断言：它们改成用 `ui.tree` / `ui.tree_event` 驱动。

## 5. 不变量（继续钉）

- 同一份输入 → 同一份文档（compose 确定性）。
- ops 原子：任一失败整批不生效，旧文档与 DOM 不变。
- 最小更新：未触碰的兄弟保持原引用，DOM 元素复用。
- 幂等：同 revision 的 data op、重复到达的 ops 是 no-op。
- 失败不静默：诊断带 code / path / message。
- 事件 → DOM 的工作量不随总节点数增长（复杂度斜率）：节点型页面由
  `packages/ui/tests/test_complexity.py` 按 build / compose / walk 计数钉线性上界；
  数据型页面由 `packages/ideas/tests/test_page_complexity.py` 钉常数——50 条与 500 条灵感，
  页面树一样大、重交一次树的处理量一样多。

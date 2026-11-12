# 仓库结构迁移记录

> 基线：`main@f090ea1`；分支：`refactor/repo-layout`。
> UI 引擎后续设计见 [Dendrolink 文档](../engine/README.md)；旧提案归档在 `docs/engine/archive/`。

## 0. 结果

| 项  | 变更                                                                    | 状态   |
| --- | ----------------------------------------------------------------------- | ------ |
| A   | `app/packages/` → 根目录 `packages/`                                    | 已落地 |
| B   | `app/boot.py` → `app/boot/__init__.py`，实现与 `app/boot/tests/` 同目录 | 已落地 |
| C   | `app/shell/` → `app/ui-engine/shell/`，shell 不再单独成 pnpm workspace  | 已落地 |

## 1. packages 移出 app

- 根目录 `packages/` 现在是系统插件的统一位置。
- uv workspace member 改为 `packages/*`；包名、入口点、import 命名空间不变。
- pytest 的 `testpaths`、coverage 的 `source`、键索引扫描根、版本同步扫描根、体量预算扫描根都已同步。
- `uv.lock` 重新生成；安装路径从 `app/packages/*` 变为 `packages/*`。
- CI 的 mypy 测试路径改为 `packages/*/tests`。

## 2. boot 合并

- `app/boot.py` 移到 `app/boot/__init__.py`，`app/boot/tests/` 留在原处。
- `from boot import Config, build, ...` 不变，调用方不需要改 import。
- boot 现在是一个自洽的包：实现与测试同目录，不再出现【目录里只有 tests、实现漂在外面】。
- boot 测试里的仓库根路径已按新深度修正。

## 3. shell 并入 UI 引擎

- Electron 主进程移到 `app/ui-engine/shell/main.cjs`。
- Electron 依赖并入 `app/ui-engine/package.json`；`pnpm-workspace.yaml` 只剩 `app/ui-engine`。
- `main.cjs` 的发布路径改为同包下的 `../dist/index.html`。
- `omora dev --shell` 从 `app/ui-engine/node_modules` 找 Electron，并启动 `app/ui-engine/shell/main.cjs`。
- ESLint 的 shell 规则范围改到 `app/ui-engine/shell/**/*.cjs`。

## 4. 验证

已实际执行：

```bash
uv sync --all-groups
uv run pytest --cov=app --cov=packages --cov-report=term-missing
uv run ruff check .
uv run ruff format --check .
uv run mypy -p omora.cli -p omora.core -p omora.sdk
pnpm install
pnpm exec eslint app/ui-engine/src app/ui-engine/shell/main.cjs
pnpm exec prettier --check .
pnpm --dir app/ui-engine exec tsc --noEmit
pnpm --dir app/ui-engine exec vitest run --coverage --configLoader runner
uv run python scripts/keys.py --check
uv run python scripts/static_ui.py --check
uv run python scripts/smoke.py
node tools/vscode/test.js
```

结果：Python 365 条测试通过，覆盖率 96.53%；TS 288 条测试通过；静态骨架、键索引、冒烟与扩展逻辑通过。

## 5. 边界与后续

- 没有实际弹出 Electron 窗口做人工验证；壳的路径解析、依赖归位和 lint 已验证。
- 运行后插件目录、TS 插件宿主、页面写作模型仍按 [迁移](../engine/migration.md) 的 S0–S5 处理；旧提案归档在 `docs/engine/archive/`。
- 迁移在 `refactor/repo-layout` 分支提交；PR 合并后本文作为历史记录保留。

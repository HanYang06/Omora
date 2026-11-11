# CI 与门禁

> 事实来源是 `.github/workflows/ci.yml`。本文解释为什么这么分层，以及各项阈值怎么定。

## 原则

1. **CI 是唯一门禁。** 本地不再维护聚合脚本；本地要验证，就按本文或 README 列出的命令逐条跑。
2. **一条命令一个 step。** 不套壳、不拼 `&&`。出问题时日志直接指到具体 command，不需要再猜是哪个 stage 挂了。
3. **job 并行、单一 required check。** 各检查各自成 job；最后 `gate` 汇总，branch ruleset 只要求 `gate` 和 `check`。
4. **覆盖率是探针，不是目标。** 覆盖率地板只用来防倒退；提高数字必须有真实行为测试，禁止写空壳断言。
5. **安全默认开。** 依赖漏洞、workflow 安全、依赖变更审查、CodeQL、secret scanning 都走自动化。

## 分层

| job            | 内容                                                                | 失败意味着               |
| -------------- | ------------------------------------------------------------------- | ------------------------ |
| `python-lint`  | `ruff check`、`ruff format --check`                                 | 规则或格式不合规         |
| `python-types` | mypy strict，程序包 / 模块 / 测试三组目标                           | 类型错误                 |
| `python-tests` | pytest + coverage（Cobertura XML），上传 GitHub Code Quality        | 行为回归或覆盖率低于地板 |
| `ts-lint`      | `eslint`、`prettier --check`                                        | lint / 格式不合规        |
| `ts-types`     | `tsc --noEmit`                                                      | 类型错误                 |
| `ts-tests`     | `vitest run --coverage`，上传 Cobertura                             | 行为回归或覆盖率低于地板 |
| `security`     | `uv audit`、`pnpm audit`、`actionlint`、`zizmor`、dependency review | 依赖或 workflow 风险     |
| `build`        | `vite build`、体量预算、文档断链                                    | 构建或仓库规则失败       |
| `windows`      | Windows 上跑 pytest 与 tsc                                          | 平台相关回归             |
| `gate`         | 汇总以上全部                                                        | 任一上游失败             |

## 覆盖率

- Python：`pytest-cov`，`source = app`，排除 `tests`，`fail_under = 95`。
- TypeScript：`@vitest/coverage-v8`，`include = src/**/*.{ts,tsx}`，排除测试、`*.d.ts`、纯类型文件与样式；初始地板 lines 54 / statements 53 / branches 52 / functions 53。
- 两边的 Cobertura XML 都作为 workflow artifact 保存 14 天；同时尽力上传 GitHub Code Quality（`actions/upload-code-coverage`，失败不阻断）。Code Quality 的覆盖率数据依赖仓库/套餐开启该能力，没开时上传会 404，此时以 CI 里的 `fail_under` / vitest 阈值为准，文件仍能从 artifact 取到。
- **抬阈值的流程**：先补真实行为的测试，确认覆盖率变了，再改阈值数字。不允许先改数字再凑测试。
- 防"垃圾测试"：PR 上用 `diff-cover` 卡新增生产代码行覆盖率；每周一 03:00 UTC 跑 `.github/workflows/mutation.yml`（TS 用 Stryker），只出报告不拦门禁，观察四周后再设地板。报告作为 artifact 保留 30 天。

## 变异测试

每周一 03:00 UTC 跑 `.github/workflows/mutation.yml`：TS 用 Stryker（vitest runner，inPlace 模式），只出变异分数与报告，不拦 PR；报告作为 artifact 保留 30 天，观察四周后再决定地板。

Stryker 用 inPlace 是因为 Stryker 10 读不了仓库的 TypeScript 7 经典编译 API；CI 是干净 checkout，跑完只留报告。

Python 侧暂未接入：mutmut 3 按仓库相对路径推导模块名（期望 `app.core.omora.*`），而 uv workspace 的 import 是 `omora.*`，trampoline 键对不上；同时它的 mutants/ 沙箱里 editable 安装仍指向原仓库。等有适配 workspace 布局的方案或工具再补，不先用一个假绿的 weekly job 占位。

## 安全与供应链

- `uv audit` 与 `pnpm audit --audit-level high` 每次 CI 跑。
- `zizmor` 审 workflow 安全（权限、模板注入、action 固定）；`actionlint` 查语法与 shell。
- 所有 action 固定到 commit SHA，由 Dependabot 每周升级。
- PR 上跑 `dependency-review-action`，新增依赖的漏洞与许可证变化要显式过目。
- CodeQL 保持 GitHub 默认 setup（actions / javascript-typescript / python），不搬进仓库，减少维护。
- 仓库设置：secret scanning + push protection 已开；Dependabot alerts 与 security updates 已开。

## 提交信息检查

- 本地 `.githooks/commit-msg` 在创建提交时校验每条提交（`scripts/commit_msg.py`）。
- CI 的 `check` workflow（`.github/workflows/commit-msg.yml`）只校验 PR 标题与 PR 最新一条提交；不遍历分支历史，历史提交不合规不会阻塞 PR。标题改了会因 `edited` 事件重跑。
- 豁免：`Merge` / `Revert` / `fixup!` / `squash!` / `amend!` 开头，或正文 footer `Commit-Format: exempt`（一次性特殊提交，写清理由）。

## 门禁规则

- `main` 只接受 merge commit；不允许 squash / rebase。
- branch ruleset `main-rules`：required checks = `gate`（本 workflow 汇总 job）+ `check`（PR 标题 + 最新提交格式）；CodeQL 与 Code Quality 保持开启；`Restrict code coverage` 已设“最大下降 1 个百分点”（最低覆盖率地板不放进 ruleset，由 CI 阈值自己卡：Python 95%、TS 54%）。
- GitHub Code Quality 的覆盖率数据依赖功能开启；当前仓库的上传接口返回 404，上传步骤按尽力而为处理，覆盖率门禁以 CI 阈值 + artifact 为准。

## 本地怎么跑

逐条执行 `.github/workflows/ci.yml` 里的命令，顺序不限。最常用的几条：

```bash
uv sync
pnpm install

uv run ruff check .
uv run ruff format --check .
uv run pytest --cov=app --cov-report=term-missing
uv run mypy -p omora.cli -p omora.core -p omora.sdk

pnpm exec eslint app/ui-engine/src app/shell/main.cjs
pnpm exec prettier --check .
pnpm --dir app/ui-engine exec tsc --noEmit
pnpm --dir app/ui-engine exec vitest run --coverage

# 仓库级检查（build job）
uv run python scripts/keys.py --check
uv run python scripts/static_ui.py --check
uv run python scripts/smoke.py
uv run python scripts/budget.py
uv run python scripts/docs_links.py
```

提交信息由 `.githooks/commit-msg` 管；推送前 `.githooks/pre-push` 会拒绝推 `main`。

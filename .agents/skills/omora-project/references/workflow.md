# 工作流与门禁

> 权威来源：`../../../../docs/engineering/discipline.md`。

## 唯一入口

```
uv run python scripts/check.py
```

本地与 CI 必须跑同一条命令。任一阶段失败立即停止，不跳过。

## 阶段

| 组 | 阶段 | 说明 |
|---|---|---|
| 卫生 | `hygiene.conflicts` | 合并冲突标记 |
| 卫生 | `hygiene.todos` | 未完成标记必须是 `(#issue)` |
| 卫生 | `hygiene.breakpoints` | 禁止 `breakpoint()` |
| 卫生 | `hygiene.whitespace` | 行尾空格、文件末尾换行 |
| 卫生 | `hygiene.versions` | VERSION / pyproject / package.json / `__version__` 一致 |
| 卫生 | `hygiene.docs-links` | 文档相对链接有效 |
| 卫生 | `hygiene.secrets` | 禁止提交 `.env` |
| 预算 | `budget.files` | 单文件行数（含文档、组件） |
| 预算 | `budget.python` | 函数行数、类方法、参数、复杂度、import 数 |
| 预算 | `skill.project` | 本 skill 的 frontmatter、链接、行数 |
| Python | `py.format` / `py.lint` | ruff |
| Python | `py.types` | pyright strict |
| Python | `py.test` | pytest |
| Python | `py.arch` | import-linter 边界 |
| Python | `py.build` | uv build |
| Web | `web.format` / `web.lint` | prettier / eslint（含体量规则） |
| Web | `web.types` / `web.test` / `web.build` | tsc / vitest / tsc |

## 预算

全部写在 `../../../../budget.json`，Python 与 ESLint 读同一份。

| 维度 | 默认 |
|---|---|
| 单文件行数 | 300（文档 400，组件 220） |
| 单函数行数 | 60 |
| 单类方法数 | 15 |
| 参数个数 | 5 |
| 圈复杂度 | 12 |
| import 数 | 20 |

超了就拆，不改预算；改预算必须在提交说明里写理由。

## 完成定义

- [ ] 改动范围与任务一致
- [ ] 门禁全绿
- [ ] 有测试证明行为
- [ ] 契约变动走三件套
- [ ] 文档同步
- [ ] 无 TODO / 调试残留 / 死代码
- [ ] 附命令与输出
- [ ] 未验证部分已标注

## 提交

`type(scope): subject`，type ∈ `feat` `fix` `refactor` `test` `docs` `chore` `contract`。

## 版本

统一版本发布：仓库内所有包同号。
PATCH 契约不变，MINOR 只加不改，MAJOR 可破。主版本号只用于契约破坏。

## 报告格式

1. 改了什么
2. 为什么
3. 怎么验证的（命令 + 输出摘要）
4. 什么没验证、为什么

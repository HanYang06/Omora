# 依赖登记

> 纪律要求：新增三方依赖必须写明理由；运行期优先使用标准库。

## 运行期依赖

| 依赖 | 位置 | 理由 |
|---|---|---|
| websockets | kernel | C1 传输：本机回环 WebSocket。标准库无 WS 服务端，手写握手与帧解析没有收益 |
| （其余） | — | 存储用标准库 `sqlite3`；契约校验用 jsonschema（开发期已登记） |

## 开发期依赖

| 依赖 | 位置 | 理由 |
|---|---|---|
| uv | 工具链 | 管理 Python 版本与环境，不依赖系统 Python |
| ruff | Python | 格式化 + lint，替代 black / isort / flake8 |
| pyright | Python | 严格类型检查 |
| pytest | Python | 测试运行器 |
| import-linter | Python | 架构边界机器校验 |
| jsonschema | Python | 契约 schema 校验 |
| hatchling | Python | 构建后端 |
| typescript | Web | 类型检查与构建 |
| eslint / @eslint/js / typescript-eslint | Web | lint 与边界规则 |
| prettier | Web | 格式化 |
| vitest | Web | 测试运行器 |

## 待评估

- SQLite 驱动：优先标准库 `sqlite3`，需要异步或有性能瓶颈时再评估。

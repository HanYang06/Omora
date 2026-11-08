# 路线图

> 这里是计划：先做什么、怎么算做完。设计在各目录的 `DESIGN.md` 里，架构在 `ARCHITECTURE.md` 里。

## 现在

- 架构定稿。
- 内核的 Context / Kernel 已落，带行为测试；Router 待写。
- 三份设计：`app/core/`、`app/packages/`、`app/ui-engine/`。

## 第一刀：闭环

**要证明**：插件 → 节点 → 界面 → 事件 → 回插件。

**范围**

- `store`（内存）、`ui`、`inbox`
- `Router` + WebSocket
- 渲染引擎（column / row / text / button）

**验收**

- `uv run pytest`：store、ui、router 的行为。
- 手动：起 Python + 引擎，浏览器看到列表；点归档，条目消失。
- `uv run ruff check .`、`uv run mypy app` 全绿。

**不做**：持久化、输入框、多视图、样式系统、TS 插件、多客户端。

## 之后（顺序待定）

- 持久化：store 换 SQLite，接口不动。
- 捕捉：输入框 + 新增条目。
- 业务插件目录定下来，第二个插件证明组合。
- server 形态：只跑 Python 进程。
- TS 插件宿主。
- 混合插件。

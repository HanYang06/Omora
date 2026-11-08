# 路线图

> 这里是计划：先做什么、怎么算做完。设计在 `docs/design/` 里，架构在 `ARCHITECTURE.md` 里。

## 现在

- 架构定稿，四条设计线（内核 / 配置 / 版本 / 插件形态）已收。
- **闭环已通**：内核 → boot + 配置 → sdk → store / ui / net / inbox → 渲染引擎。
- 测试：Python 49 条、TS 25 条，全绿。
- 设计：`docs/design/core.md`、`config.md`、`protocol.md`、`versioning.md`、`packages.md`、`ui-engine.md`。
- 门禁：`uv run python scripts/check.py`（体量预算 + 测试 + lint + 类型 + 前端构建）。
- 版本同步：`scripts/sync_version.py`；`VERSION` 与各 package 同号的断言测试。
- 发布构建：`scripts/build.py`，产物 `dist/omora-<version>.zip`。

## 已完成：闭环

证明了「插件 → 节点 → 界面 → 事件 → 回插件」。

- 内核：四个词 + 句柄 + 撤销容错
- boot：读两份配置、按序装、报没人认领的段
- 协议：call / result / error，两侧各一份，同一份 fixture 钉住
- 插件：store / ui / net / inbox
- 渲染引擎：React + Vite + vitest

验收：`uv run python scripts/check.py` 全绿；Python 端到端测试真连 WebSocket 走通闭环。

## 下一刀：能起来

**要证明**：代码里的有序列表 → 读两份配置 → 构造插件 → 装进内核 → 报没人认领的段。

**范围**

- boot（位置待定）：有序列表、读 `config.ini` + `config.yaml`、逐键合并
- 系统插件的配置声明 + 构建生成 `config.ini`
- 两个空插件，证明顺序与开关

**验收**

- `uv run pytest`：合并、覆盖、开关生效、未认领段被报出来。
- 手动：改 `config.yaml` 关掉一个插件，重启后它不在。
- `uv run ruff check .`、`uv run mypy app` 全绿。

**不做**：界面、协议、任何领域。

## 第二刀：闭环

**要证明**：插件 → 节点 → 界面 → 事件 → 回插件。

**范围**

- `net`（系统插件）+ 最小协议 + WebSocket
- `ui`、`inbox`（`store` 已落）
- 渲染引擎（column / row / text / button）

**验收**

- `uv run pytest`：store、ui 的行为、net 的分发。
- 手动：起 Python + 引擎，浏览器看到列表；点归档，条目消失。
- `uv run ruff check .`、`uv run mypy app` 全绿。

**不做**：持久化、输入框、多视图、样式系统、TS 插件、多客户端、主动推送。

## 之后（顺序待定）

- 持久化：store 换 SQLite，接口不动。
- 捕捉：输入框 + 新增条目。
- 生态开放时才需要：运行后插件目录 + 安装器。在这之前不做。
- server 形态：只跑 Python 进程。
- TS 插件宿主。
- 混合插件。

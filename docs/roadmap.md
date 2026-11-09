# 路线图

> 这里是计划：先做什么、怎么算做完。设计在 `docs/design/` 里，架构在 `ARCHITECTURE.md` 里。

## 现在

- 母 UI（浅色）+ 界面库 v1 + 灵感页 + 音频捕获已落。
- 仓库是 uv workspace：`omora-core` / `omora-sdk` / 每个 `omora-plugin-*` 都是 member；import 命名空间 `omora.*`。
- 存储：SQLite（`.omora/omora.db`）；媒体文件（`.omora/media`）。
- 测试：Python 83 条、TS 36 条，全绿。
- 门禁：`uv run python scripts/check.py` 全绿。
- 项目 / 需求是占位页；深色主题待单独设计；视频、转写、AI 未做。

## 已完成：workspace 化

把插件从“目录 + 元数据”变成真正的子项目：

- `omora-core` / `omora-sdk` / 每个 `omora-plugin-*` 各有 pyproject / 依赖 / `omora` 命名空间 / tests
- import 命名空间收进 `omora.*`；插件入口点写在自己的 pyproject
- boot 的清单只留有序名字，按入口点找插件类
- 一个 lock / 一个 venv；单独开发：`uv run --package omora-plugin-ideas pytest`
- 验收：`check.py` 全绿；72 条 Python 测试按入口点装起来跑

## 已完成：通用 store

把 store 从 ideas 专用接口改成通用持久化服务：

- `collection` + 字段/索引声明 + CRUD + 结构化查询；插件不写 SQL
- ID 字符串 UUID；`created_at` / `updated_at` 自动
- 迁移规则：开发期不写，发布时冻结（`docs/design/migrations.md`）
- 验收：`check.py` 全绿；83 条 Python 测试

## 已完成：媒体与捕获基础

证明了「录音 → 媒体落盘 → 条目落库 → 列表播放」这条链路。

- `media` 插件：文件 + `index.json`，`save` / `load`
- `store` 从内存换成 SQLite：`Item` 带 `media`；重启不丢
- `ideas`：录音条 + 文字捕捉；录音回调收 base64，先存媒体再写条目
- 引擎：`recorder` / `audio` 组件，媒体按需取
- 验收：`check.py` 全绿；无头浏览器 + 假麦克风录 2 秒，列表出现“语音 0:02”，播放按钮在

## 已完成：母 UI 与界面库 v1

证明了「母页面定槽位 → 插件登记页面 → 页面用词表组合 → 事件带载荷回插件」。

- 协议：`ui.render` / `ui.event` 返回页面快照 `{pages, page, meta, content}`
- ui 插件：页面登记（name / label / count）、快照渲染、payload 透传
- 界面库：input / list / item / empty，button 加 ghost，text 加 muted，Page 信封
- ideas 插件：捕捉 + 账本 + 归档 + 空状态
- 渲染引擎：`shell.tsx` 默认母页面、浅色主题、页面快照

验收：`uv run python scripts/check.py` 全绿；本地起 Python + 引擎，浏览器里捕捉、归档、空状态都走通。

## 接下来（顺序待定）

- 本地转写：Whisper 跑在 Python，后台；转写结果挂到条目上。
- 视频捕获：同一套媒体管线；二进制换 HTTP 媒体通道。
- AI 接口插件：本地转写 + 云端明确化分析（provider、同意提示、草稿 UI）。
- 关联 / 网：灵感之间的 `sparked` / `related` 边，候选关联。
- 详情页：点开一条灵感。
- GitHub provider：PR / issue / action 作为产物来源。
- 深色主题、搜索、窄屏、TS 插件宿主、房间、server 形态。

## 已完成：闭环

证明了「插件 → 节点 → 界面 → 事件 → 回插件」。

- 内核：四个词 + 句柄 + 撤销容错
- boot：读两份配置、按序装、报没人认领的段
- 协议：call / result / error，两侧各一份，同一份 fixture 钉住
- 插件：store / ui / net / 一条样例页面
- 渲染引擎：React + Vite + vitest

验收：`uv run python scripts/check.py` 全绿；Python 端到端测试真连 WebSocket 走通闭环。

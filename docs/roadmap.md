# 路线图

> 这里是计划：先做什么、怎么算做完。设计在 `docs/design/` 里，架构在 `ARCHITECTURE.md` 里。

## 现在

- 母 UI（浅色，三栏）+ 界面库 v1 + 灵感页（三栏工作台）+ 音频 / 视频捕获已落。
- 仓库是 uv workspace：`omora-core` / `omora-sdk` / 每个 `omora-plugin-*` 都是 member；import 命名空间 `omora.*`。
- 存储：SQLite（`.omora/omora.db`）；媒体文件（`.omora/media`）。
- 测试：Python 237 条、TS 164 条，全绿。
- 门禁：`uv run python scripts/check.py` 全绿。
- 灵感页有传统（非 AI）搜索：建议下拉、结果视图、详情与返回。
- 插件管理器已落：清单、`[tool.omora]` 条件（平台 / 能力 / 依赖服务）、开关与设置页；
  客户端能力上报后，带能力条件的插件按需装上。
- 捕捉拆成 audio / video 两个插件；硬件检测在客户端（无设备默认禁用）；
  **音频和视频都走 HTTP 媒体通道**（音频不再走 base64）。
- 捕捉改成首页**就地工作区**：点块就地展开、停即落库（录了即存）、已保存条与收起；
  两种录法（点一下＝长录可暂停 / 按住空格＝对讲）、实时与静态波形、保存后按时间轴起名并给一次改名；
  音频不限时长、视频 30 分钟。文字仍是一行过渡形态，等单独设计。见 [捕捉工作区](design/ui-capture.md)。
- 团队流程：**一个功能 = 一个 PR**，多区分支合进集成分支只提一个 PR（见 [omora-team](.agents/skills/omora-team/SKILL.md)）。
- 项目 / 需求是占位页；深色主题待单独设计；转写、AI 未做。

## 已完成：workspace 化

把插件从“目录 + 元数据”变成真正的子项目：

- `omora-core` / `omora-sdk` / 每个 `omora-plugin-*` 各有 pyproject / 依赖 / `omora` 命名空间 / tests
- import 命名空间收进 `omora.*`；插件入口点写在自己的 pyproject
- boot 的清单只留有序名字，按入口点找插件类
- 一个 lock / 一个 venv；单独开发：`uv run --package omora-plugin-ideas pytest`
- 验收：`check.py` 全绿；72 条 Python 测试按入口点装起来跑

## 已完成：捕捉拆成两个插件

音频和视频不再挤在一个插件里：缺麦克风只关音频，缺摄像头只关视频。

- `audio` / `video` 两个系统插件，各自 pyproject / 入口点 / 配置段 / 元数据能力；
  后期处理钩子（audio 收字节，video 收 media id）
- 客户端硬件检测：`enumerateDevices` / `getUserMedia` / `devicechange`；没设备就禁用并写原因，
  权限只在点按钮时申请，多设备可选，热插拔实时更新
- 视频走 HTTP 媒体通道（`POST /media` 上传、`GET /media/{id}` 播放，带大小上限与 CORS）；
  音频仍走 base64
- ideas 按服务名组装捕捉条：audio / video 不在，页面就只剩文字与搜索
- 验收：`check.py` 全绿；两个插件的设备门禁、时限、后期钩子、HTTP 通道的错误分支都有行为测试

## 已完成：三栏首页

灵感页从“一页账本”变成三栏工作台，页面结构第一次写进 [三栏首页](design/ui-home.md)：

- 母页面：56px 图标栏（页面导航，每页一个图标）+ 主区；不再 720px 居中
- 词表：`split` / `rail` / `icon` / `tile` / `chip` / `card`，`Item` 加 `on_click`（整行可点）
- ideas：`Split(Rail(全部灵感), 主区)`，主区六种模式——首页（搜索 + 三个捕捉大按钮 +
  筛选 + 推荐 feed）、结果、详情、文字 / 录音 / 视频捕捉；置顶与归档只在详情里
- 验收：`check.py` 全绿；headless 浏览器截图核对三栏渲染

## 已完成：传统搜索

浏览器式搜索，一个 AI 都没有：

- store：`searchable` 声明 + `search`（参数化 LIKE 子串，标题命中 → 置顶 → 新的）
- sdk：`Search` / `Suggestion` / `Result` 三个节点
- 引擎：`search` 组件管 200ms 防抖、上下键、回车 / 按钮提交、Esc 收下拉
- ideas：搜索状态（query / suggestions / results / detail）、建议下拉、结果视图、详情、返回
- 协议：fixture 增加页面快照段，Python 的 serialize 与 TS 的形状检查都读它
- 验收：`check.py` 全绿；store / ideas / 引擎的行为测试覆盖子串、参数化、分页、排名、
  建议与结果的流转、无结果状态

语义检索（"牛头不对马嘴"）不在这一版：等 AI 插件接进来，换的是 ideas 里调 `search` 那一行。

## 已完成：通用 store

把 store 从 ideas 专用接口改成通用持久化服务：

- `collection` + 字段/索引声明 + CRUD + 结构化查询；插件不写 SQL
- ID 字符串 UUID；`created_at` / `updated_at` 自动
- 迁移规则：开发期不写，发布时冻结（`docs/design/migrations.md`）
- 验收：`check.py` 全绿；83 条 Python 测试

## 已完成：插件管理器

把"装哪些、能不能开"从 boot 的硬编码变成可解释的清单：

- `manager` 系统插件：清单、`[tool.omora]` 条件（platforms / capabilities / listed /
  requires）、生效开关、阶段与原因
- boot 先装 store + manager，其余由 manager 按清单装；manager 不碰内核，走 host 服务
- 开关存 store 的 `settings` collection；config.ini 只给默认值、仍然只读
- 设置页「插件」：状态、条件、原因、启用 / 禁用；启动项不可关
- 能力通道：引擎连上后上报客户端能力，manager 不探测硬件

验收：`uv run python scripts/check.py` 全绿；清单 / 条件 / 开关 / 卸载清理 / boot 顺序 /
WebSocket 端到端都有行为测试。

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

## 已完成：捕捉工作区（就地 + 录了即存）

把「点按钮 → 整页捕捉 → 保存 → 回首页」换成「点按钮 → 就地展开 → 停即落库」。

- 入口：点 `Tile` 不换页，捕捉区那一块换成工作区（头部 + 捕捉节点），索引栏与 feed 不动
- 录了即存：停止 = 落库，没有保存确认；录完给一条「已保存」：播放（音频）+ 再录一条 + 收起
- 视频去掉「回看 / 重录 / 保存」：停即上传即提交，上传失败原地给重试，字节不出内存
- 卸载即提交：收起、换页、关窗口都不会把正在录的那段丢掉
- 文字 v1 只做就地一行、回车即存 —— 它要回答的是「什么时候算一条」，另开一份设计

验收：`uv run python scripts/check.py` 全绿；人工走一遍录音 / 视频 / 收起 / 断网重试。

## 已完成：录法、波形与命名

把「只有一种录法、录完什么都不能改」补成手机录音机那一套。

- 两种录法：点大圆钮＝长录（可暂停/继续，音频不限时长）；按住空格＝对讲，松手即停即存、不进命名
- 进工作区不等于开始录：点 Tile 只把工作区摆出来，开录另一下
- 波形：录制中 100ms 采一次实时电平；保存后把同一份峰值（≤300 根）画成静态波形（仅音频）
- 命名：先落库（默认名 `语音 11-11 03:41`），再给一次改名机会；不填就用默认
- 音频改走 HTTP 媒体通道：十分钟的录音按 base64 塞不进一个帧
- 误触保护：不到 0.4 秒不落库，连媒体文件一起丢掉
- 时长上限：`[audio] max_seconds = 0`（不限）、`[video] max_seconds = 1800`

验收：`uv run python scripts/check.py` 全绿；headless 浏览器 + 假麦克风走通「点开→录→暂停→继续→停→改名→收起」与「按住空格→松手落库」。
## 接下来（顺序待定）

- **手机当摄像头（Android 客户端）**：桌面自带的摄像头往往很差，手机的好得多。
  走网页这条路有硬限制——浏览器只给"安全上下文"开摄像头，实测同一个页面从
  `http://127.0.0.1` 打开 `navigator.mediaDevices` 正常，从 `http://192.168.x.x` 打开
  直接是 `undefined`；要绕开只能自签证书/装证书，对普通用户就是一次吓人的警告。
  所以决定做成 Android 客户端：原生调度摄像头，绕开浏览器门禁，顺带能拿到设备能力、
  多镜头、对焦/曝光这些网页 API 给不全的东西。桌面侧要准备的：内网监听（现在 net 只绑
  127.0.0.1）、一次性配对 token、局域网发现。录制仍建议在手机上按全分辨率进行，
  回传后走已有的 CRF 后处理。
- **摄像头档位自适应**：现在清晰度固定档（最高 1080p、默认 720p）。接上高质量摄像头后
  应按 `getCapabilities()` 自动选档（auto），CRF 跟着分辨率分级（1080p 用 23、720p 用 26），
  免得好镜头被 720p 压住、差镜头被高码率撑大。
- 本地转写：Whisper 跑在 Python，后台；转写结果挂到条目上。
- AI 接口插件：本地转写 + 云端明确化分析（provider、同意提示、草稿 UI）。
- 关联 / 网：灵感之间的 `sparked` / `related` 边，候选关联。
- GitHub provider：PR / issue / action 作为产物来源。
- 深色主题、窄屏、TS 插件宿主、房间、server 形态。

## 已完成：闭环

证明了「插件 → 节点 → 界面 → 事件 → 回插件」。

- 内核：四个词 + 句柄 + 撤销容错
- boot：读两份配置、按序装、报没人认领的段
- 协议：call / result / error，两侧各一份，同一份 fixture 钉住
- 插件：store / ui / net / 一条样例页面
- 渲染引擎：React + Vite + vitest

验收：`uv run python scripts/check.py` 全绿；Python 端到端测试真连 WebSocket 走通闭环。
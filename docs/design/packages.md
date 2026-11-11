# 插件设计

插件是内核唯一的扩展单位。这篇写插件是什么、怎么打包，以及现在这几个系统插件怎么设计。

## 1. 插件是什么

- 一个对象：`name: str` + `apply(ctx)`。
- 一个 package：`app/packages/<name>/`，自己的 pyproject、依赖、src、tests。
- 按语言分三种形态：Python、TS、混合。各自能碰多深的界面见 `ARCHITECTURE.md` §5.2。
- `apply` 里只做登记：`ctx.provide(...)`、`ctx.effect(...)`、`ui.page(ctx, ...)`。
- 插件之间不 import；要说话就按服务名。

每个系统插件就是一个 package：

```
app/packages/<name>/
  pyproject.toml      # name / version / description / dependencies / entry point / [tool.omora]
  omora/<name>.py     # 插件对象（单文件）
  tests/              # 行为测试
```

- 目录名 = 插件名；发行名 `omora-plugin-<name>`；import 名 `omora.<name>`。
- 入口点写在自己的 pyproject：`[project.entry-points."omora.plugins"] <name> = "omora.<name>:<Class>"`。boot 的清单只留有序名字，插件类按入口点找。
- 元数据写在自己的 `[tool.omora]`：`platforms` / `capabilities` / `listed` / `requires`；manager 在装载前按它检查条件。省略即默认：全平台、无能力要求、`listed = true`、无服务依赖。见 [插件管理器](plugin-manager.md)。
- `omora/py.typed` 是 package 的一部分（mypy 靠它把 `omora.*` 当源码而不是第三方）。
- 版本字段必须有，但由 `scripts/sync_version.py` 从根 `VERSION` 同步，不手写、不单独定版本。
- 依赖：插件依赖 `omora-sdk`，SDK 依赖 `omora-core`；第三方依赖写在自己的 pyproject。
- 一个 uv workspace、一个 lock、一个 venv：系统插件一起发，环境不分裂；隔离的是项目边界、依赖声明和测试。单独开发：`uv run --package omora-plugin-ideas pytest`。
- `app/core/` = `omora-core`，`app/sdk/` = `omora-sdk`，`app/packages/*` = 系统插件；三者都是 workspace member。
- 门禁：`app/boot/tests/test_packages.py` 查 package / 入口点 / manifest / config 对齐；`test_version.py` 查版本。

## 2. 两类插件

分类轴是**来源**，不是产出。

|            | 系统插件                                                                    | 运行后插件          |
| ---------- | --------------------------------------------------------------------------- | ------------------- |
| 位置       | `app/packages/`                                                             | 待定                |
| 来源       | 随包                                                                        | 单独装              |
| 开关       | 启动期的配置决定                                                            | 用户装              |
| 例子       | store、manager、media、ui、audio、video、ideas、projects、requirements、net | —（现在一个都没有） |
| 缺了会怎样 | 应用降级；后果由插件自己说清                                                | 少一个功能          |

产出页面不是分类轴：两种插件都可能产出页面，都可能只是给服务。运行后插件同样是 package，目录和打包格式还没定。

## 3. sdk：插件唯一可以 import 的东西

`app/sdk/`（`omora-sdk`）是公开面，不是插件：

- 再导出 `Context`、`Plugin` 类型；
- 放 UI 节点类型与序列化（`app/sdk/omora/sdk/ui.py`）；
- 放协议编解码（`app/sdk/omora/sdk/protocol.py`）。

插件只 import `omora.sdk` / `omora.sdk.ui` / `omora.sdk.protocol`，不 import `omora.core`。sdk 依赖 core；core 不知道 sdk。

## 4. store（系统插件）

- 职责：通用持久化服务。不产出界面，也不认识任何领域。
- 服务接口：

```python
class Store:
    def collection(
        self,
        name: str,
        *,
        fields: Mapping[str, str],
        indexes: Sequence[str] = (),
        searchable: Sequence[str] = (),
        pinned: str | None = None,
    ) -> Collection: ...


class Collection:
    def add(self, **values: Any) -> Record: ...
    def get(self, record_id: str) -> Record | None: ...
    def update(self, record_id: str, **values: Any) -> Record: ...
    def delete(self, record_id: str) -> None: ...
    def find(
        self,
        where: Mapping[str, Any] | None = None,
        *,
        order: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[Record]: ...
    def count(self, where: Mapping[str, Any] | None = None) -> int: ...
    def search(
        self,
        query: str,
        *,
        limit: int = 50,
        offset: int = 0,
        where: Mapping[str, Any] | None = None,
    ) -> list[Record]: ...
```

- 领域模型由插件声明：字段名 / 类型（`text` / `int` / `float` / `bool` / `time`，`?` 表示可选）/ 索引。
- 查询：结构化 `where`（等值 + `$ne/$gt/$gte/$lt/$lte/$in`）、`order`、`limit`（上限 200）、`offset`；参数化 SQL，插件不写 SQL；字段名、排序字段、limit 都校验。
- 记录：id 是字符串 UUID；`created_at` / `updated_at` 自动；`Record` 支持 `record["title"]` 和 `record.title`。
- 搜索：`searchable` 声明可搜字段（只能是 `text`，第一个算标题），`search` 用参数化 LIKE 做
  子串匹配；查询词和过滤条件都走绑定参数，插件不写 SQL。排序是「标题命中 → 置顶 → 新的」，
  `pinned` 声明一个 `bool` 字段当置顶信号。空查询没有结果。FTS5 是后面的升级，接口不变。
- 迁移：见 [迁移](migrations.md)——开发期不写，发布时冻结。
- 位置：`[store] path`（默认 `.omora/omora.db`）。`.omora/` 是本地数据目录，已忽略。
- 为什么先 SQLite：捕获的条目不重启就丢是硬伤；换后端只改这个插件内部，接口不动。

## 5. media（系统插件）

- 职责：音频 / 视频文件的存取。不产出界面，也不认识任何领域。
- 服务接口：

```python
class Media:
    def save(self, data: bytes, mime: str) -> str: ...
    def upload(self, data: bytes, mime: str) -> str: ...
    def load(self, media_id: str) -> dict[str, str]: ...
    def read(self, media_id: str) -> dict[str, Any]: ...
    def info(self, media_id: str) -> dict[str, Any]: ...
    def delete(self, media_id: str) -> None: ...
```

- 数据：文件放 `[media] root`（默认 `.omora/media`），一个 `index.json` 记 mime / size；
  `load` 返回 mime + base64，`read` 返回原始字节。
- 参数名是合同：net 按关键字转发，调用方必须写 `media_id`，不能写 `id`。
- `upload` 是 HTTP 媒体通道的入库口：空媒体与超过 `[media] max_mb`（默认 64）都拒；
  `info` 给 mime / size，`delete` 让视频插件清理被拒的录像，不留孤儿文件。
- 二进制怎么过协议：音频 v0 走 base64；视频走 net 的 HTTP 媒体通道
  （`POST /media` 上传、`GET /media/{id}` 播放，见 [协议设计](protocol.md) §7）。
  通道归 net（它持有 socket），存盘归 media。

## 6. 捕捉：audio 与 video（系统插件）

捕捉拆成**两个插件**，不是一个插件的两半：没有麦克风只该关掉音频，没有摄像头只该关掉视频。

|            | audio                            | video                                  |
| ---------- | -------------------------------- | -------------------------------------- |
| package    | `app/packages/audio/`            | `app/packages/video/`                  |
| 服务       | `audio`                          | `video`                                |
| 元数据     | `capabilities = ["microphone"]`  | `capabilities = ["camera"]`            |
| 配置段     | `[audio]`                        | `[video]`                              |
| 管什么     | 音质档、降噪、时限、后期处理钩子 | 清晰度档、时限、大小上限、后期处理钩子 |
| 字节怎么来 | base64（协议 v0）                | HTTP 媒体通道，事件只带 media id       |

共同点：

- **硬件枚举在引擎，判断在插件**：引擎只把设备种类（`audioinput` / `videoinput`）报给 manager，
  不认识"麦克风"这种产品词；`audio` / `video` 自己读事实决定出不出捕捉节点。
  设备门禁（没有设备时禁用按钮并写原因）在组件里；权限只在用户点按钮时才要；多设备给选择器；热插拔实时更新。
- 插件不知道页面长什么样，只给节点：`audio.node(on_submit)` / `video.node(on_submit)`。
  页面（现在的 ideas）按服务名 `has()` 决定放不放、放哪。
- 都依赖 `media`（元数据 `requires = ["media"]`）；video 还要求 net 的媒体通道已经起来，
  没起来就不出捕捉条（视频存不下，出了也没用）。
- 后期处理钩子：`add_processor(...)`。audio 的钩子是 `bytes + mime → bytes`；video 的钩子是
  `(media_id, {mime, size}) → None`（v0 只看不改，没有转码）。
- 健康状态不自己造：插件的生命周期（phase + reason）由 manager 统一给，捕捉插件不发明第二套。

配置：

```ini
[audio]
enabled = true
quality = high          ; high / low
noise_reduction = true
max_seconds = 600

[video]
enabled = true
quality = 720p          ; 480p / 720p / 1080p
max_seconds = 120
max_mb = 64
```

`quality` 只能是枚举里的值，写错了启动期就报错（不静默降级）。
时限在服务端再判一次：超时的录音 / 录像不收；视频还会把已上传的文件删掉，不留孤儿。

## 7. ui（系统插件）

- 职责：页面登记、渲染、事件派发。它不碰 socket，也不认识任何业务。
- 服务接口：

```python
class Ui:
    def page(
        self,
        ctx: Context,
        name: str,
        label: str,
        build: Callable[[], Page],
        count: Callable[[], int] | None = None,
    ) -> None: ...
    def contribute(
        self,
        ctx: Context,
        target: str,
        build: Callable[[], Node],
        *,
        order: int = 0,
    ) -> None: ...
    def render(self, page: str | None = None) -> dict[str, object]: ...
    def event(self, handler: str, payload: dict[str, object]) -> dict[str, object]: ...
```

### 7.0 贡献

- `contribute(ctx, target, build, order=0)` 往一个键挂一棵树；归属取 `ctx.name`（插件名）。
- 快照里多一个 `contributions` 列表；页面主树仍是 `content`，引擎组合前会给它的根打上 `om.window.page`。
- 落点键存不存在由引擎判断：键不在，引擎丢弃并记日志，不算错。

### 7.1 页面登记

- `page()` 把 name / label / build / count 存进表，并在传入的 ctx 上登记一条移除副作用——插件卸载时页面自动消失。
- 返回一个页面对象：`handle.set(Page(...))` 自己交树（推送式），`handle.refresh()` 把当前树重交一次；
  给了 `build` 回调的还是拉取式。`projects` / `requirements` 已经用推送式。
- 同名页面重复登记 → `ValueError`（v0 不允许覆盖）。
- `render()` 不指定页面名时画第一个登记的。

### 7.2 渲染

1. 该页面的 `serial` += 1（只增不减），这一次画出来的 handler id 用这个 serial；
2. 把上一代的 handler 表挪进 `previous`，开一张新的；
3. 调 `build()` 得到 `Page(meta, content)`；
4. 序列化 content：字段名 → `props`；可调用字段 → 分配 `{page}:{serial}:{n}` 并记进 handler 表
   （记住所属页面）；`None` 字段不写；`children` 递归；
5. 返回页面快照：`{pages, page, meta, content}`。`pages` 按登记顺序，`count` 每次现算。

**handler id 永不复用。** serial 只增不减，因为每次画都会把同一类位置重新编号；如果 id 回收，
一个「重画之前出发、重画之后才回来」的事件就会打到新树里同序号、却完全不相干的回调上。
典型场景：组件卸载时提交录制的那一段（见 [捕捉工作区](ui-capture.md) §5）。

### 7.3 派发

- 找 handler：先查当代，再查上一代（`previous`）；上一代只留一次宽限，下一次画就被替换掉；
- 命中上一代说明有个事件比它的树慢了一拍：写一条 `ui.event.stale`（带 handler 与 page），不静默；
- 把 payload 交给它 → 重画它所属的页面 → 返回新快照；
- 两代都找不到 → `LookupError`，由 net 插件包成错误帧。

### 7.4 页面与节点

- `Page(content, meta)`：content 是节点树，meta 是标题旁那句话（比如“3 条”）。
- 词表：`Column`、`Row`、`Text`、`Button`、`Input`、`Recorder`、`Audio`、`List`、`Item`、`Empty`、
  `Search`、`Suggestion`、`Result`、`AudioCapture`、`VideoCapture`、`Video`、`Hotkey`、`Waveform`。

## 8. 产出页面的插件

### 8.1 ideas（灵感）

- 依赖 `store`、`media`、`ui`，按名字取；缺了就让 `apply` 抛错（v0 不降级）。
- 页面 `ideas`：搜索框 + 文字捕捉 + 由 audio / video 提供的捕捉条 + 账本列表 + 播放 +
  置顶 + 归档 + 空状态。audio / video 没装就只有文字；它们没起来（比如没有媒体通道），
  对应捕捉条根本不出现。
- 录音：`audio_capture` 的回调交给 audio 服务，它收 base64、存进 media、返回 id；
  录像交给 video 服务（字节已经过 HTTP 通道进来，事件里只有 media id）。页面只负责写 store。
- 播放：音频走 `media.load`（base64），视频走 HTTP 媒体通道的 `src`；字节都不进快照。
- 搜索：插件持有 `{mode, query, open}` 三个状态，外加一个返回历史栈。打字收
  `{value}`，取前 5 条命中做下拉建议；提交进结果视图（导航不变，左栏留着），结果行带
  命中片段（查询词前后截窗）、时间和语音 / 置顶标记；点开进详情，返回按历史走回上一屏。
  搜索走 store 的 `search`，只用标题命中，所以 snippet 是标题里的一小段。
- 视图只读状态；写状态只发生在回调里。引擎不知道"灵感"是什么，也知道不了：换 AI 检索
  只改这个插件的 `search` 那一行。
- 卸载零残留：ui 的登记挂在 ctx 上。

### 8.2 projects / requirements（占位）

- 各登记一个空页，让导航里出现项目 / 需求。
- 字段还没定，所以没有任何数据操作；字段定了再长。

### 8.3 manager（插件管理）

- 职责：插件清单、`[tool.omora]` 条件、开关与设置页。不 import 内核，装 / 卸走 boot
  提供的 `host` 服务。
- 服务接口：

```python
class Manager:
    def inventory(self) -> dict[str, object]: ...
    def set_enabled(self, name: str, enabled: bool) -> dict[str, object]: ...
    def report_devices(self, devices: list[str]) -> dict[str, object]: ...
```

- 清单顺序 = boot 的 `SYSTEM_PLUGINS`；每行的元数据来自 package 的 `[tool.omora]`。
- 开关存在 store 的 `settings` collection（`plugin` / `enabled`），config.ini 只给默认值。
- 平台 / 能力 / 服务条件不满足 → `disabled` 并带原因；装失败 → `failed`。
- 设置页通过 ui 插件登记：`plugins`，标签「插件」；store / manager 是启动项，不给开关。
- 细节见 [插件管理器](plugin-manager.md)。

## 9. 边界

- `packages` 不 import `omora.core`；只 import `omora.sdk`。

- `sdk` 不 import `packages`。
- store、manager、media、ui、audio、video、ideas、projects、requirements、net 互不 import。
- 界面不是插件关心的事：插件只产出节点，不碰 DOM / CSS。
- 捕捉插件不知道字节怎么存（那是 media 的），也不知道页面上有没有自己（那是页面的事）。

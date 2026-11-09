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
  pyproject.toml              # name / version / description / dependencies / entry point
  src/omora/plugins/<name>/   # 插件对象
  tests/                      # 行为测试
```

- 目录名 = 插件名；发行名 `omora-plugin-<name>`；import 名 `omora.plugins.<name>`。
- 入口点写在自己的 pyproject：`[project.entry-points."omora.plugins"] <name> = "omora.plugins.<name>:<Class>"`。boot 的清单只留有序名字，插件类按入口点找。
- 版本字段必须有，但由 `scripts/sync_version.py` 从根 `VERSION` 同步，不手写、不单独定版本。
- 依赖：插件依赖 `omora-sdk`，SDK 依赖 `omora-core`；第三方依赖写在自己的 pyproject。
- 一个 uv workspace、一个 lock、一个 venv：系统插件一起发，环境不分裂；隔离的是项目边界、依赖声明和测试。单独开发：`uv run --package omora-plugin-ideas pytest`。
- `app/core/` = `omora-core`，`app/sdk/` = `omora-sdk`，`app/packages/*` = 系统插件；三者都是 workspace member。
- 门禁：`app/boot/tests/test_packages.py` 查 package / 入口点 / manifest / config 对齐；`test_version.py` 查版本。

## 2. 两类插件

分类轴是**来源**，不是产出。

| | 系统插件 | 运行后插件 |
|---|---|---|
| 位置 | `app/packages/` | 待定 |
| 来源 | 随包 | 单独装 |
| 开关 | 启动期的配置决定 | 用户装 |
| 例子 | store、media、ui、ideas、projects、requirements、net | —（现在一个都没有） |
| 缺了会怎样 | 应用降级；后果由插件自己说清 | 少一个功能 |

产出页面不是分类轴：两种插件都可能产出页面，都可能只是给服务。运行后插件同样是 package，目录和打包格式还没定。

## 3. sdk：插件唯一可以 import 的东西

`app/sdk/`（`omora-sdk`）是公开面，不是插件：

- 再导出 `Context`、`Plugin` 类型；
- 放 UI 节点类型与序列化（`app/sdk/src/omora/sdk/ui.py`）；
- 放协议编解码（`app/sdk/src/omora/sdk/protocol.py`）。

插件只 import `omora.sdk` / `omora.sdk.ui` / `omora.sdk.protocol`，不 import `omora.core`。sdk 依赖 core；core 不知道 sdk。

## 4. store（系统插件）

- 职责：条目的持久化与查询。
- SQLite，一个文件，一个表；不产出界面。
- 服务接口：

```python
class Store:
    def items(self) -> list[Item]: ...
    def add(self, title: str, media: str | None = None) -> Item: ...
    def archive(self, item_id: int) -> None: ...
```

- 数据：`Item(id, title, archived, created_at, media)`；id 自增；`created_at` 在加入时记下；`media` 是 media 插件给的 id。
- 位置：`[store] path`（默认 `.omora/omora.db`）。`.omora/` 是本地数据目录，已忽略。
- 为什么先 SQLite：捕获的条目不重启就丢是硬伤；换后端只改这个插件内部，接口不动。

## 5. media（系统插件）

- 职责：音频 / 视频文件的存取。不产出界面，也不认识任何领域。
- 服务接口：

```python
class Media:
    def save(self, data: bytes, mime: str) -> str: ...
    def load(self, media_id: str) -> dict[str, str]: ...
```

- 数据：文件放 `[media] root`（默认 `.omora/media`），一个 `index.json` 记 mime / size；`load` 返回 mime + base64。
- 参数名是合同：net 按关键字转发，调用方必须写 `media_id`，不能写 `id`。
- 二进制怎么过协议：v0 走 base64（短音频够用）；视频和大文件下一步换成 HTTP 媒体通道。

## 6. ui（系统插件）

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
    def render(self, page: str | None = None) -> dict[str, object]: ...
    def event(self, handler: str, payload: dict[str, object]) -> dict[str, object]: ...
```

### 6.1 页面登记

- `page()` 把 name / label / build / count 存进表，并在传入的 ctx 上登记一条移除副作用——插件卸载时页面自动消失。
- 同名页面重复登记 → `ValueError`（v0 不允许覆盖）。
- `render()` 不指定页面名时画第一个登记的。

### 6.2 渲染

1. 给该页面开一代（generation += 1），清掉上一代的 handler；
2. 调 `build()` 得到 `Page(meta, content)`；
3. 序列化 content：字段名 → `props`；可调用字段 → 分配 `{page}:{gen}-{n}` 并记进 handler 表（记住所属页面）；`None` 字段不写；`children` 递归；
4. 返回页面快照：`{pages, page, meta, content}`。`pages` 按登记顺序，`count` 每次现算。

### 6.3 派发

- 找 handler → 把 payload 交给它 → 重画它所属的页面 → 返回新快照。
- 找不到 → `LookupError`，由 net 插件包成错误帧。

### 6.4 页面与节点

- `Page(content, meta)`：content 是节点树，meta 是标题旁那句话（比如“3 条”）。
- 词表：`Column`、`Row`、`Text`、`Button`、`Input`、`Recorder`、`Audio`、`List`、`Item`、`Empty`。

## 7. 产出页面的插件

### 7.1 ideas（灵感）

- 依赖 `store`、`media`、`ui`，按名字取；缺了就让 `apply` 抛错（v0 不降级）。
- 页面 `ideas`：录音条 + 文字捕捉 + 账本列表 + 播放 + 归档 + 空状态。
- 录音：`Recorder` 的回调收 `{audio(base64), mime, seconds}`；先存进 media，再写 store。
- 视图只读状态；写状态只发生在回调里。
- 卸载零残留：ui 的登记挂在 ctx 上。

### 7.2 projects / requirements（占位）

- 各登记一个空页，让导航里出现项目 / 需求。
- 字段还没定，所以没有任何数据操作；字段定了再长。

## 8. 边界

- `packages` 不 import `omora.core`；只 import `omora.sdk`。
- `sdk` 不 import `packages`。
- store、media、ui、ideas、projects、requirements、net 互不 import。
- 界面不是插件关心的事：插件只产出节点，不碰 DOM / CSS。

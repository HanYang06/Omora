# 第一刀设计：协议、节点、插件、渲染引擎

> 这是下一步的实现约定。和 `ARCHITECTURE.md` 冲突时，以架构文档为准，并回来改这里。
> 只写这一刀要用的；没定的标"未定"。

## 1. 这一刀要证明什么

一个 Python 插件画出一个列表和一排按钮；点按钮回到 Python；状态改了；界面跟着变。

要证明的链路只有一条：

```
插件 → 节点树 → 内核转发 → 渲染引擎 → 事件 → 回插件
```

不证明：多插件协作、持久化、样式系统、多视图、TS 插件。

## 2. 参与者与目录

```
app/
  core/                 # 内核：Context、Kernel、Router（Context/Kernel 已完成）
  sdk/                  # 插件唯一可以 import 的东西：Plugin/Context 类型 + UI 节点类型
  packages/
    store/              # 内核级插件：条目存储（v0 放内存）
    ui/                 # 内核级插件：ui 服务（视图与回调登记、序列化）
  plugins/
    inbox/              # 业务插件：收件箱视图（目录暂定）
  ui-engine/            # 渲染引擎（TS）
  main.py               # 组合根：装插件、起 WebSocket、把帧交给 Router
```

`app/sdk/` 和 `app/plugins/` 是这一刀新增的两块，先按这个摆，定了再写进架构文档。

## 3. 协议

本机 WebSocket，JSON 文本帧，一条连接。没有鉴权、没有多客户端、没有服务端主动推送。

请求：

```json
{"id": 1, "target": "ui", "method": "render", "args": {"view": "main"}}
```

响应只有两种：

```json
{"id": 1, "type": "result", "value": [...]}
{"id": 1, "type": "error", "code": "call_failed", "message": "..."}
```

- `target` 是服务名，`method` 是那个服务的方法，`args` 原样作为关键字参数传入。
- 内核只解析信封，`value` 对它是不透明数据。
- 错误码：`bad_frame`、`unknown_target`、`unknown_method`、`call_failed`。

渲染引擎的流程：

1. 连上，发 `render({view: "main"})`；
2. 收到 `result`，整棵树画出来；
3. 点按钮，发 `event({handler: "h3-2", payload: {}})`；
4. 收到 `result`，整棵树重画。

## 4. 节点

```json
{"type": "column", "props": {}, "children": [
  {"type": "text", "props": {"text": "收件箱", "kind": "title"}, "children": []},
  {"type": "row", "props": {}, "children": [
    {"type": "text", "props": {"text": "写周报"}, "children": []},
    {"type": "button", "props": {"text": "归档", "on_click": "h3-2"}, "children": []}
  ]}
]}
```

- 节点只有 `type`、`props`、`children` 三个键；`children` 为空也照写。
- `props` 只放 JSON 值；`None` 的字段不写。
- 回调不进节点，进 `props` 里的字符串 id。
- 组件词表 v0：`column`、`row`、`text`、`button`。只加真的用到的。
- 未知类型：渲染引擎画占位并记一条日志，不崩。

Python 侧就是 dataclass。`app/sdk/ui.py`：

```python
@dataclass(frozen=True)
class Text:
    text: str
    kind: str | None = None

@dataclass(frozen=True)
class Button:
    text: str
    on_click: Callable[[], None]

@dataclass(frozen=True)
class Column:
    children: tuple[Node, ...]
```

序列化是通用的：字段名就是 `props` 的键；遇到可调用字段就登记成 handler id。不给每个组件写 schema。

## 5. 插件与 ui 服务

插件接口不变（内核已完成）：

```python
class Plugin(Protocol):
    name: str
    def apply(self, ctx: Context) -> None: ...
```

`ui` 插件提供 `ui` 服务，三个方法：

| 方法 | 做什么 |
|---|---|
| `view(ctx, name, build)` | 登记一个视图的构造函数；登记挂在 `ctx` 上，插件卸载时自动移除 |
| `render(view)` | 调构造函数，序列化，返回节点 |
| `event(handler, payload)` | 找到回调、执行、重画它所属的视图，返回新节点 |

inbox 插件：

```python
from app.sdk import Context
from app.sdk.ui import Button, Column, Row, Text

class Inbox:
    name = "inbox"

    def apply(self, ctx: Context) -> None:
        store = ctx.resolve("store")
        ui = ctx.resolve("ui")

        def build():
            return Column(tuple(
                Row((Text(item.title), Button("归档", lambda: store.archive(item.id))))
                for item in store.items()
            ))

        ui.view(ctx, "main", build)
```

注意：视图构造函数里只读状态；写状态发生在回调里。回调跑完由 `ui` 重画，不手写刷新。

## 6. 事件与重画

- 事件到达 → 找 handler → 执行 → 重画它所属的视图 → 返回整棵树。
- handler id 每次重画重新生成：`h{generation}-{n}`；重画前清掉该视图上一代的 handler。
- 旧 id 视为未知，走 `call_failed`。
- v0 整棵树重画；局部更新等真卡了再说。

## 7. 内核与转发

`Router` 放进 `app/core/router.py`：

```python
class Router:
    def handle(self, frame: object) -> dict[str, object]
```

- 校验信封 → `resolve(target)` → `getattr(service, method)(**args)` → 包成 `result`。
- 它不认识 `render` / `event` / 节点；换一个服务、换一个方法，它照转。
- 组合根 `app/main.py` 只做三件事：装插件、起 WebSocket、把每帧丢给 `Router`。

## 8. 边界

- 内核不 import `sdk`、`ui`、`store`、`inbox`。
- 插件只 import `sdk`；不 import 内核，也不 import 别的插件。
- `ui` 服务不知道 WebSocket；`main.py` 不知道节点长什么样。
- 渲染引擎只认 `{type, props, children}` 和 handler id。

## 9. 依赖

- Python：`websockets`（传输，第一个真正需要的第三方依赖）。
- TS：vite + React（渲染引擎）。版本落代码时定。

## 10. 这一刀不做

持久化（v0 的 store 在内存里）、多视图 / 多槽位（v0 只有 `main`）、输入框与捕捉、样式与设计 token、TS 插件、多客户端、鉴权、重连、局部更新。

## 11. 验收

- `uv run pytest`：store 的行为、ui 的登记 / 渲染 / 派发、router 的信封校验与转发。
- 手动：`uv run python app/main.py` + `cd app/ui-engine && pnpm dev`，浏览器看到列表；点归档，条目消失。
- `uv run ruff check .`、`uv run mypy app` 全绿。

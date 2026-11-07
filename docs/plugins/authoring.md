# 写一个插件

> 目标读者：想给 Omora 加功能的人。读完你应该能写出一个能被人装上的插件，而不是改内核。

## 0. 先理解一件事

**内核不认识你的领域。** 它不知道什么是灵感、项目、需求。它只提供：事件、状态折叠、命令、查询、服务、槽位。

所以插件的工作方式是：你声明事件与折叠规则，内核替你保管状态；你发命令，内核落库并广播事件；你给出节点树，前端渲染。

## 1. 最小插件（能跑）

两个文件：

```
plugins/hello/
├─ plugin.json
└─ src/omora_plugins_hello/__init__.py
```

`plugin.json`（清单，必须通过 `protocol/c2-manifest.schema.json`）：

```json
{
  "id": "hello.notes",
  "name": "Hello",
  "version": "0.1.0",
  "engines": { "omora": "^0.1.0" },
  "runtime": "python",
  "entry": "omora_plugins_hello:plugin",
  "activation": ["onStartup"],
  "capabilities": ["commands", "events", "ui"],
  "contributes": {
    "commands": [{ "id": "hello.add", "title": "记一句" }],
    "slots": [{ "id": "hello.panel", "slot": "sidebar", "order": 5 }]
  }
}
```

`__init__.py`：

```python
from omora_sdk import Node, Plugin, PluginContext, card, input_, list_, stack, text


class HelloPlugin:
    async def activate(self, ctx: PluginContext) -> None:
        ctx.state.register("hello.added", _fold_added)  # 状态怎么长
        ctx.commands.register("hello.add", _add(ctx))  # 能做什么
        ctx.ui.contribute("hello.panel", _view)  # 长什么样

    async def deactivate(self) -> None:
        pass  # 登记项挂在作用域上,宿主卸载时自动回收


def _fold_added(state: dict[str, object], data) -> None:
    items = state.setdefault("items", [])
    items.append({"text": data.get("text")})


def _add(ctx: PluginContext):
    async def handler(args):
        await ctx.events.emit("hello.added", {"text": args.get("text", "")})
        return None

    return handler


def _view(state) -> list[Node]:
    return [
        stack(
            [
                text("最近记录", variant="title"),
                list_("$items", [card([text("$item.text")])], empty_text="还没有内容"),
            ]
        ),
        input_("写一句", submit="hello.add", args={"text": "$value"}),
    ]


plugin: Plugin = HelloPlugin()
```

就这些。不需要改内核、不需要问谁要权限。

## 2. 你能用的七样东西

| 能力 | API | 说明 |
|---|---|---|
| 命令 | `ctx.commands.register(name, handler)` | 用户或界面触发的动作；handler 是 `async def (args) -> object` |
| 查询 | `ctx.queries.register(name, handler)` | 只读；必须返回 `{"items": [...]}` |
| 事件 | `ctx.events.emit / subscribe` | 已发生的事实；跨插件唯一的广播通道 |
| 状态 | `ctx.state.register / read` | 登记折叠规则；只能读自己的切片 |
| 界面 | `ctx.ui.contribute(id, view)` | 返回 C3 节点树；view 收到自己的状态切片 |
| 服务 | `ctx.services.provide / call` | 点对点调用别的插件；对方没装就抛 `E_UNAVAILABLE` |
| 日志 | `ctx.log.info / warn / error` | 自动按插件归因，不受能力限制 |

还有两个注入的原语：`ctx.ids.next()` 与 `ctx.clock.now()`。**不要用 `uuid4` 或 `datetime.now`**——注入是为了让测试确定。

## 3. 四条硬规则

1. **命令只发事件。** 状态由 reducer 折叠出来，命令不直接改切片。这样重启能重放、跨插件能同步。
2. **界面是数据。** view 返回节点树（`Stack` / `Text` / `Button` / `Input` / `List` / `Card`），不碰 DOM、不写 CSS，颜色用主题 token。
3. **只能 import `omora_sdk`。** 不 import 内核、不 import 别的插件。想用别人的能力，走服务。
4. **声明什么用什么。** 清单里没写的 capability，调用时直接 `E_DENIED`。

## 4. 三个常见坑

| 坑 | 后果 | 正解 |
|---|---|---|
| 在 view 里做 IO 或 await | 渲染是同步纯函数，会直接坏 | 数据在 reducer 里折好 |
| 把状态当全局缓存互相共享 | 卸载留下幽灵数据 | 需要什么就订阅什么，折进自己的切片 |
| 用 `uuid4` / `datetime.now` | 测试不可重复 | 用注入的 `ctx.ids` / `ctx.clock` |

## 5. 怎么调试

```bash
uv run python -m omora_kernel --database .omora/dev.sqlite --plugins plugins
cd web && pnpm dev
uv run python scripts/accept_p1.py --url ws://127.0.0.1:8765   # 全链路自检
```

清单写错、引擎不兼容、入口导入失败，宿主会打日志并**跳过**这个插件，不会让整个内核崩掉——先看内核日志第一位。

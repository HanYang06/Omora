# 内核设计

内核只做一件事：在 Python 进程里托管插件，并把信封转给服务。
它不知道 UI，不知道领域，不知道协议内容。位置：`app/core/`。

## 1. 它不做什么

- 不认 UI：节点树、组件、槽位都是不透明数据。
- 不认领域：没有灵感 / 项目 / 需求。
- 不解析协议内容：只读信封，`args` 与 `value` 原样传递。
- 不管依赖：插件自己 `has()` / `resolve()`。

## 2. 三个对象

### Context：服务表 + 副作用账本

- 一个 Context 代表一次装载的作用域。
- **服务表**是整棵作用域树共享的 `dict[str, object]`；**账本**是每个 Context 自己的 `list[Callable]`。
- `provide(name, value)`：写服务表，同时往当前账本记一条 undo（只删自己写的那一项）。
- `resolve(name)`：读表；没有就抛 `LookupError`。
- `has(name)`：查表。
- `effect(fn)`：往账本追加。
- `dispose()`：逆序跑账本、清空；可重复调用；撤销后再登记抛 `RuntimeError`。
- `extend()`：新建子 Context，共享服务表、自带账本。

为什么服务表共享、账本分开：插件之间要能按名字取到彼此的服务；但卸载只能撤自己登记的东西。

### Kernel：插件表 + 生命周期

- 持有 `_root: Context` 与 `_plugins: dict[str, Context]`。
- `install(plugin)`：
  1. 重名 → `ValueError`；
  2. `ctx = root.extend()`；
  3. `plugin.apply(ctx)`；
  4. 成功 → 记进插件表；失败 → `ctx.dispose()` 后原样上抛。
- `uninstall(name)`：先从插件表摘掉，再 `dispose()`。先摘后撤，回调里 `running()` 已经是 false。
- `running(name)` / `names()`：只读插件表。
- `resolve(name)`：转发到根 Context。

为什么 `apply` 是同步的：v0 的插件都是纯内存装配。传输层是异步的，但它不经过 `apply`。

### Router：信封 → 服务方法

- 输入：`{"id", "target", "method", "args"}`。
- 输出：`{"id", "type": "result", "value"}` 或 `{"id", "type": "error", "code", "message"}`。
- 步骤：校验信封 → `resolve(target)` → `getattr(service, method)` → `(**args)` 调用 → 包结果。
- 错误码：`bad_frame`（信封不合法）、`unknown_target`、`unknown_method`、`call_failed`（方法抛了异常，message 原样带出）。
- Router 不认识 `render`、`event`，也不看 `args` / `value`。

为什么 Router 在内核里：架构文档把"消息转发"算作内核职责；而它只需要 `resolve` + `getattr`，不需要认识任何服务。

## 3. 一次安装 / 卸载的时序

```
install(p):
  p.name in _plugins?        → ValueError
  ctx = _root.extend()
  try: p.apply(ctx)
  except: ctx.dispose(); raise
  _plugins[p.name] = ctx

uninstall(name):
  ctx = _plugins.pop(name, None)
  if ctx: ctx.dispose()
```

## 4. 错误模型

| 情况 | 抛什么 | 谁接 |
|---|---|---|
| 服务不存在 | `LookupError` | 调用方；经 Router 时是 `call_failed` |
| 同一作用域重复提供服务 | `ValueError` | 插件自己 |
| 插件重名 | `ValueError` | 调 `install` 的人 |
| 撤销后再登记 | `RuntimeError` | 插件 |
| 信封不合法 | Router 返回 `bad_frame` | 传输层 |

## 5. 不变量

1. 内核不 import `sdk`、`packages`、`plugins`、UI。
2. 一个服务名在同一时刻只有一个提供者。
3. 卸载后，该插件登记的服务与副作用全部消失。
4. `install` 失败不留半装状态：服务、副作用、插件表里都没有它。
5. 内核 API 全部同步，不依赖 asyncio。

## 6. 没做的

- 依赖声明与自动排序（插件自己查）。
- 异步 `apply` / 异步服务。
- 插件进程隔离。
- 事件总线（要就做成服务）。
- 卸载时 `dispose` 抛错的处理：v0 直接上抛；将来要决定是收集后上抛，还是中断。

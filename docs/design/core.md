# 内核设计

内核只做四件事：加持、持有、引用、运行。位置：`app/core/`。

纯同步，不碰 I/O，不碰配置，不认识消息帧。

## 1. 四个词，五个方法

| 词   | 方法                                          | 做什么                               |
| ---- | --------------------------------------------- | ------------------------------------ |
| 加持 | `Kernel.install(plugin)`                      | 装一个插件                           |
| 持有 | `Kernel.running(name)`、`Kernel.names()`      | 记着谁在                             |
| 引用 | `Kernel.resolve(name)`                        | 按名字取服务                         |
| 运行 | `Kernel.uninstall(name)`、`Context.dispose()` | 跑 apply；卸载时逆序撤销它登记的一切 |

插件手里拿到的是 `Context`：`provide` / `resolve` / `has` / `effect` / `dispose` / `extend`。

`install` 和 `uninstall` 是同一个词（运行）的两头：装的时候跑 `apply`，卸的时候跑账本。

## 2. 它不做什么

- 不认 UI：节点树、组件、槽位都是不透明数据。
- 不认领域：没有灵感 / 项目 / 需求。
- 不认配置：配置在 boot 里合并完、插件对象构造好之后，才交给内核。
- 不认消息帧：转发是 net 插件（系统插件）的事。
- 不认系统 / 运行后：分类住在 boot 和安装器里。
- 不管依赖：插件自己 `has()` / `resolve()`。
- 不管并发：服务方法会不会被并发调用，由分发它的人回答。
- 不做 I/O：不读配置、不开 socket、不写日志文件。

## 3. 两个对象

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
- `install(plugin)`：重名 → `ValueError`；开子作用域；跑 `apply`；成功记进插件表，失败 `dispose()` 后原样上抛。
- `uninstall(name)`：先从插件表摘掉，再 `dispose()`。先摘后撤，回调里 `running()` 已经是 false。
- `running(name)` / `names()`：只读插件表。
- `resolve(name)`：转发到根 Context。

为什么 `apply` 是同步的：装载是纯内存装配。传输是异步的，但它不在内核里。

## 4. 一次安装 / 卸载的时序

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

## 5. 错误模型

| 情况                   | 抛什么                         | 谁接              |
| ---------------------- | ------------------------------ | ----------------- |
| 服务不存在             | `LookupError`                  | 调用方            |
| 同一作用域重复提供服务 | `ValueError`                   | 插件自己          |
| 插件重名               | `ValueError`                   | 调 `install` 的人 |
| 撤销后再登记           | `RuntimeError`                 | 插件              |
| 撤销动作自己抛错       | 现状是直接上抛，后面的撤销不跑 | 未定，见第 7 节   |

## 6. 不变量

1. 内核不 import `sdk`、`packages`、`plugins`、`ui`、`net`。
2. 一个服务名在同一时刻只有一个提供者。
3. 卸载后，该插件登记的服务与副作用全部消失。
4. `install` 失败不留半装状态：服务、副作用、插件表里都没有它。
5. 内核 API 全部同步，不依赖 asyncio。
6. 内核不做 I/O：不读配置、不开 socket、不写文件。

## 7. 没做的 / 未定

- 依赖声明与自动排序（插件自己查）。
- 异步 `apply` / 异步服务。
- 插件进程隔离。
- 事件总线（要就做成服务）。
- 撤销动作抛错的策略：现状是中断后上抛；未定是"全跑完再抛"还是保持中断。
- `install` 失败时把插件名裹进异常：现状是原样上抛，没有这一层。
- `Context.extend()` 对外暴露：内核内部要用，外部有没有真实用途未定。
- 更细的观测面（列出每个插件提供了什么）：现状只有 `names()`。

## 8. 参照

形状参照 **cordis**——DSH 的内核就是它，随包在 `@deepseek-ai/cordis`（源码在 `src/`，未压缩）。

| 这里                          | cordis                                                     |
| ----------------------------- | ---------------------------------------------------------- |
| `Context.provide` / `resolve` | `ctx.provide` / `ctx.set` / `ctx.get`，以及 `Service` 基类 |
| `Context.effect`              | `ctx.effect()`                                             |
| `Context.dispose`             | `ctx.fiber.dispose()`                                      |
| `Context.extend`              | `ctx.extend(meta)` / `ctx.fork()`                          |
| `Kernel.install`              | `ctx.plugin()`，返回 Fiber                                 |
| 插件 `name` + `apply(ctx)`    | 函数 `(ctx, config)`，或 `{ apply, inject }`               |

**抄 `context.ts` / `registry.ts` 的形状，不要抄 `fiber.ts`。** 后者是异步激活、重启、配置热更新、HMR 的合集，正是这里明确不做的。

cordis 有、这里没有的：`inject` 依赖注入、事件总线、异步 `apply`、Fiber 状态机、`isolate` / `intercept`、loader 的配置驱动加载、`Service` 的代理魔法、logger。

砍掉之后由这几样补位：装配顺序归 boot 的有序列表；要事件就做成服务；装载必须在事件循环起来之前完成。

将来要不要长回 cordis 的样子，是成本问题，不是对错问题。现在的形状已经留好了接缝：

| 以后可能要的                             | 现在怎么留                                      |
| ---------------------------------------- | ----------------------------------------------- |
| 插件句柄（`install` 返回值、单独卸一个） | `install` 以后返回句柄即可，现在的 API 不用改   |
| 依赖声明（`inject`）                     | 是插件的元数据 + 注册表里查一次，Context 不用改 |
| 事件总线                                 | 做成服务，形状不变                              |

真正会改形状的只有一个：`apply` 从同步变异步。这件事装载期不需要，所以不做。

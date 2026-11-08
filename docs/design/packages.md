# 插件设计

插件是内核唯一的扩展单位。这篇写插件是什么，以及 store、ui、inbox 三个插件怎么设计。
位置：`app/packages/`（系统插件）；运行后插件目录待定。

## 1. 插件是什么

- 一个对象：`name: str` + `apply(ctx)`。
- 按语言分三种形态：Python、TS、混合。各自能碰多深的界面见 `ARCHITECTURE.md` §5.2。
- `apply` 里只做登记：`ctx.provide(...)`、`ctx.effect(...)`、`ui.view(ctx, ...)`。
- 插件之间不 import；要说话就按服务名。

## 2. 两类插件

分类轴是**来源**，不是产出。

| | 系统插件 | 运行后插件 |
|---|---|---|
| 位置 | `app/packages/` | 待定 |
| 来源 | 随包 | 单独装 |
| 开关 | 启动期的配置决定 | 用户装 |
| 例子 | store、ui、net | —（现在一个都没有） |
| 缺了会怎样 | 应用降级；后果由插件自己说清 | 少一个功能 |

产出页面不是分类轴：两种插件都可能产出页面，都可能只是给服务。

## 3. sdk：插件唯一可以 import 的东西

`app/sdk/` 是公开面，不是插件：

- 再导出 `Plugin`、`Context` 类型；
- 放 UI 节点类型与序列化（`app/sdk/ui.py`）。

插件 import 它；它不 import 任何插件。内核也不 import 它。

## 4. store（系统插件）

- 职责：条目的存储与查询。
- 服务接口：

```python
class Store:
    def items(self) -> list[Item]: ...
    def add(self, title: str) -> Item: ...
    def archive(self, item_id: int) -> None: ...
```

- 数据：`list[Item]`，`Item(id, title, archived)`；id 自增。
- 为什么先内存：这一版验证的是「插件 → 节点 → 界面 → 事件」的闭环。换成 SQLite 时只改这个插件的内部，接口不动。
- 卸载：数据随插件消失（v0 内存）。持久化之后，卸载不删数据。

## 5. ui（系统插件）

- 职责：视图登记、渲染、事件派发。它不碰 socket，也不认识任何业务。
- 服务接口：

```python
class Ui:
    def view(self, ctx: Context, name: str, build: Callable[[], Node]) -> None: ...
    def render(self, view: str) -> list[dict[str, object]]: ...
    def event(self, handler: str, payload: dict[str, object]) -> list[dict[str, object]]: ...
```

### 5.1 视图登记

- `view()` 把 build 存进表，并在传入的 ctx 上登记一条移除副作用——插件卸载时视图自动消失。
- 同名视图重复登记 → `ValueError`（v0 不允许覆盖）。

### 5.2 渲染

1. 给该视图开一代（generation += 1），清掉上一代的 handler；
2. 调 `build()` 得到节点树；
3. 序列化：字段名 → `props`；可调用字段 → 分配 `h{gen}-{n}` 并记进 handler 表（记住所属视图）；`None` 字段不写；`children` 递归。

### 5.3 派发

- 找 handler → 执行 → 重画它所属的视图 → 返回新节点。
- 找不到 → `LookupError`，由 net 插件包成错误帧。

### 5.4 节点

- dataclass，字段即 `props`，`children` 是 tuple。
- v0：`Column`、`Row`、`Text`、`Button`。
- `Button.on_click` 是回调；序列化时变成 handler id。

## 6. inbox（系统插件，产出页面）

- 依赖 `store`、`ui`，按名字取；缺了就让 `apply` 抛错（v0 不降级）。
- 视图 `main`：标题 + 条目行（标题 + 归档按钮）。
- 视图只读状态；写状态只发生在回调里。
- 卸载零残留：ui 的登记挂在 ctx 上。

## 7. 边界

- `packages` 不 import `core`；只 import `sdk`。
- `sdk` 不 import `packages`。
- store、ui、net 互不 import。
- 界面不是插件关心的事：插件只产出节点，不碰 DOM / CSS。

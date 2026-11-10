# 日志与观察性

## 为什么

两个进程（内核 + 渲染引擎）各跑各的，日志天然分成两股。开发时最难受的不是
"没有日志"，是**点了没反应也无从判断**：事件到没到内核、handler 存不存在、
哪个插件在装、哪一帧失败了——都没有痕迹。

这份文档定三件事：日志的形状、谁写、怎么一眼看全。

## 一条时间线

**内核是唯一的写者。** 引擎不写文件，它把每一行作为一帧送到内核：

```
target=log  method=write  args={proc: "engine", ch: "...", lvl: "...", msg: "...", data: {...}}
```

内核收下之后，和它自己的日志走同一条路：同一个文件、同一个终端输出。
所以你在终端里看到的是一条按时间排好的线，不是两个窗口对不上。

为什么不两边各写一个文件再合并：Windows 上两个进程同时轮转同一个文件会互相
rename 打架；分文件又得再写一个合并器。让内核当唯一写者，代价只是一个 dev
端点，省掉一套并发。

引擎那边**攒批**发：最多 100ms 或 20 条 flush 一次，一帧带一个数组：

```
target=log  method=write_many  args={entries: [{proc, ch, lvl, msg, data}, ...]}
```

一条一帧会让打日志变成打协议。单条 `write` 保留，给一次性调用用。

## 一行长什么样

落盘 `.omora/logs/dev.jsonl`，一行一条 JSON：

```json
{
  "ts": "2026-11-10T23:50:01.123",
  "proc": "kernel",
  "ch": "ideas",
  "lvl": "info",
  "msg": "ui.event",
  "data": { "handler": "ideas:2:5", "ms": 1.4 }
}
```

`msg` 是**点分事件名**，不是一句话：可 grep、可统计、不随文案漂移。人看的部分在
`data` 里。终端上是同一行：

```
23:50:01.123 K ideas  ui.event        handler=ideas:2:5 ms=1.4
23:50:01.160 E render render.received page=ideas nodes=31 ms=1.1
```

`K` / `E` 分别是内核和引擎，后面是通道。

## 通道

两边的日志作用不同，所以通道分开，能各自过滤：

| 进程 | 通道       | 打什么                                                                         |
| ---- | ---------- | ------------------------------------------------------------------------------ |
| 内核 | `boot`     | `config.unclaimed` / `boot.started` / `boot.media.started`                     |
| 内核 | `<插件名>` | `plugin.installed` / `plugin.removed` / `plugin.failed`                        |
| 内核 | `ui`       | `ui.render` / `ui.event` / `ui.event.unknown`                                  |
| 内核 | `net`      | `net.connected` / `net.disconnected` / `net.call.failed` / `net.call`（trace） |
| 引擎 | `conn`     | `conn.open` / `conn.closed` / `conn.failed` / `capability.report_failed`       |
| 引擎 | `render`   | `render.received`（页名、节点数、耗时）                                        |
| 引擎 | `event`    | `event.sent`（handler、payload 的键）                                          |
| 引擎 | `media`    | `media.failed`                                                                 |

帧级别的 `net:call` 默认是 `trace`，量太大，需要时单独开。

## 级别与开关

- 默认 `info`；`-v`（或 `OMORA_LOG=debug`）看细节；`OMORA_LOG=trace` 连帧都看。
- 引擎侧默认关：`?log=debug` 或 `VITE_OMORA_LOG=debug` 打开，不发就等于没有开销。
- 文件固定 DEBUG 以上全收，终端按级别过滤——事后翻档永远比当时少开一格强。

## 插件怎么用

```python
def apply(self, ctx: Context) -> None:
    log = ctx.log  # 通道名就是插件名
    log.info("装了", count=12)
    log.warning("服务缺失", service="audio")
```

没有配置日志时（测试里）拿到的是静音出口，不会因为少了日志服务就崩。

## 轮转

`logging.handlers.RotatingFileHandler`：5 MB 一轮，留 3 份。用标准库，不自己写。

## 不做的

不收集环境信息、不上报任何东西、不做远程日志。生产形态默认只写 warning 到
文件，终端安静。

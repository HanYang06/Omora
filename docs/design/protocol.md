# 协议设计

两个 runtime 之间只有这一条协议。**形状是合同**：写在这里，Python 与 TS 各实现一份，用同一份 fixture 钉住。
实现它的是 net 插件（见 `packages/net/`）；内核不认识帧。

## 0. 先说场景：这是本机 IPC，不是网络

这条协议只跑在 `127.0.0.1`，两个进程在同一台机器上。它要回答的是"两个 runtime 怎么把状态对齐"，
不是"怎么在坏网络里活下来"。下面每个设计都从实测出发（2026-11-12，本机 loopback 实测）：

| 指标                                                    | 实测                                                             |
| ------------------------------------------------------- | ---------------------------------------------------------------- |
| 一次 call → result 往返（含 JSON 编解码，一条 WS 连接） | mean 0.148ms，median 0.142ms，p99 0.254ms                        |
| 200 条灵感页全量快照                                    | 51 KiB，405 节点；序列化 0.56ms + dumps 0.38ms；JS 解析 0.24ms   |
| 500 条灵感页全量快照                                    | 124 KiB，1005 节点；序列化 1.49ms + dumps 0.92ms；JS 解析 0.53ms |
| 同上，新增一条的增量                                    | 127 字节                                                         |
| 同上改用 msgpack                                        | 少 26% 字节；pack 快 2.3x，unpack 快 1.4x                        |

三个结论决定了这次重写升什么、不升什么：

1. **传输不是瓶颈。** 一次往返 0.15ms；换 UDS / HTTP3 / WebTransport 能省的只是这个数的一部分，
   而且渲染引擎跑在 Chromium 里，只说 WS / fetch / WebRTC / WebTransport。
2. **快照是瓶颈。** 每次事件回整棵树，成本随节点数线性长；500 条就是 3ms 级 CPU，外加一次全树重渲染。
3. **缺的是推送。** 下行只能搭 result 的车，后端有事说不出口，双向只剩一半。

所以这次重写升的是**语义**：帧类型、订阅、增量快照、多路复用、背压、可测量。传输仍然是 WebSocket。

## 1. 传输

- WebSocket，文本帧，一条消息一帧 JSON，一条连接。
- 默认 `ws://127.0.0.1:8765`，地址由 `config.ini` 的 `[net]` 决定。
- 只收文本帧；二进制帧这次不实现（§9 写了为什么不急），收到回 `bad_frame`。
- 不做版本协商：两个进程一起发布、共用一个版本号，帧里不带版本。
- 媒体字节还有一条旁路：音频与视频都走 HTTP 媒体通道（§7），帧里只传 media id。

## 2. 四种帧

```
call   {"id": "1", "type": "call",   "target": "ui", "method": "render", "args": {"page": "ideas"}}
result {"id": "1", "type": "result", "value": {...}}
error  {"id": "1", "type": "error",  "code": "unknown_target", "message": "服务未提供: x"}
event  {"type": "event", "topic": "ui.snapshot", "payload": {...}}
```

规矩：

- `id` 必须是非空字符串，由**发起方**分配，只在本侧发起空间内唯一；对端在 result / error 里原样回填。
- **方向由 `type` 决定，不由 id 决定**：收到 `call` 就是对端在调我，收到 `result` / `error` 就是有人在回我的调用。
  因此两侧的 id 可以重名，不需要前缀，也不需要 `origin` 字段。
- `event` 没有 id、不带回复，只由 net 发；TS 要告诉 Python 事情就用 `call`。
  收到不认识的 `topic` 必须静默忽略（不是错误，也不能把它当断线）。
- `args` 必须是对象；缺省按 `{}`。
- 一次调用一帧结果。没有流式：要进度就 emit，见 §5。
- `bad_frame` 时 id 允许为 `null`（帧都没解析出来）。

## 3. 错误码

| code             | 什么时候                                                                                                 |
| ---------------- | -------------------------------------------------------------------------------------------------------- |
| `bad_frame`      | JSON 不合法、不是对象、缺 `id` / `target` / `method`、`type` 不是 `call`、`args` 不是对象                |
| `unknown_target` | 这个名字没有服务                                                                                         |
| `unknown_method` | 服务没有这个方法，或它不是可调用的                                                                       |
| `call_failed`    | 方法抛了异常；`message` 是 `str(exc)`，不带 traceback                                                    |
| `overloaded`     | 回帧放不进发送队列（队列里已经全是没送出去的回帧，说明客户端没在读）；调用**可能已经执行过**，重试要幂等 |

客户端在连接层自己造的错误（`not_connected` / `connection_closed` / `connection_failed` / `timeout`）
不是帧，不走这张表。

## 4. 方向、并发与顺序

- 上行：`call` 调服务（订阅也走它，见 §5）。
- 下行：`result` / `error` 回调用；`event` 主动推。
- 服务方法全是同步的，net 内联调用；**服务不会被并发调用**，插件不需要加锁。这条在新协议里不变。
- 每连接的收帧分发是串行的；**发送独立于分发**：net 有一个发送任务 + 有界队列。
  一个慢调用不会挡住已经入队的 event，推送不等服务锁。
- 顺序：同一连接上发出的帧按入队顺序。**一次 call 处理期间 emit 的 event 排在这个 call 的 result 之后**
  （net 在分发时先缓冲，回完 result 再 flush），客户端不会先收到一个自己还没有版本的补丁。
- 优先级：**回帧永远优先于 event**。队列满时先丢最老的待发 event（计入 dropped），
  event 也会被 coalesce 换掉；只有连一条 event 都丢不出来（队列里全是回帧）才回 `overloaded`。
- 内联是快路径，也是风险：一次同步调用会占住事件循环（媒体 HTTP 在同一个循环里）。
  约定是**服务方法要快（目标 < 10ms），慢活必须挪后台线程，做完用 emit 通知**。
  单帧处理超过 10ms 记一条 `net.slow_call` 警告（带 target / method / ms），让这件事可见，不靠自觉。
- 什么时候回帧、能不能主动推，都是 net 的职责，写在这里的是形状。

### 4.1 超时与重连（客户端职责）

- `call` 默认 30s 超时，超时 reject `CallError{code:"timeout"}`；长调用显式传 `timeout: 0` 关掉。
- 断线后指数退避重连（0.5s → 10s，带抖动）。连接状态仍是 `idle` / `connecting` / `open` / `closed` / `failed`。
- 重连成功后**客户端重放**：上报设备（`manager.report_devices`）、重画当前页（`ui.render`）、
  重建订阅（`net.subscribe`）。订阅挂在连接上，服务端不需要会话恢复，也不需要记住谁是谁。

### 4.2 插件管理调用

manager 是普通服务，不新增帧类型：

| 调用                     | args                                  | 返回     |
| ------------------------ | ------------------------------------- | -------- |
| `manager.inventory`      | `{}`                                  | 清单快照 |
| `manager.report_devices` | `{"devices": ["audioinput"]}`         | 清单快照 |
| `manager.set_enabled`    | `{"name": "ideas", "enabled": false}` | 清单快照 |

设备是客户端的事实：引擎在连接 open 后上报一次原始设备种类；Python 侧不探测硬件，也不拿它决定装不装。

## 5. 订阅与推送

- `call {"target": "net", "method": "subscribe", "args": {"topics": ["ui.snapshot", "media.progress"]}}`
  → `result {"topics": ["ui.snapshot", "media.progress"]}`；`unsubscribe` 同形状。
  两者都回操作完之后这条连接上的 topic 列表：去重、保持首次订阅的顺序。
- topic 是普通字符串，不通配。订阅挂在连接上，断开即清空。
- **net 不判断 topic 认不认识**：没有注册表、没有白名单，net 里不出现任何领域 topic 名。
  subscribe 任何非空字符串都成功；没有生产者就永远收不到东西，这不是错误。
  `args.topics` 不是非空字符串组成的数组 → `bad_frame`。
- 没订阅的连接收不到该 topic 的 event：net 过滤，不靠客户端忽略。
  不认识的 topic 的 event 静默忽略（§2）。
- Python 侧发推送：`ctx.resolve("net").emit(topic, payload)`，同步、非阻塞、立即入队；没有连接就丢弃。
  SDK 给一层薄封装 `omora.sdk.realtime.emit(ctx, topic, payload)` —— 内核不新增概念，插件仍只靠服务名。
- `emit(..., coalesce=True)`：队列里同 topic 的旧消息被这条替换。给"只关心最新值"的流用（进度、光标）。

## 6. 快照、版本与增量

全量快照仍然是 `result.value`，只多一个 `version`：

```json
{
  "pages": [{ "name": "ideas", "label": "灵感", "icon": "ideas", "glyph": "M2 2h16", "count": 3 }],
  "page": "ideas",
  "meta": "3 条",
  "content": { "type": "column", "props": {}, "children": [] },
  "contributions": [],
  "topics": ["ui.snapshot", "audio.peaks"],
  "version": 12
}
```

- `version` 是页面自己的单调计数，由 ui 插件给；net 不解释它，只负责运。
- `topics` 是这一页要订的推送 topic（可选，缺省只订 `ui.snapshot`）；客户端按它订阅与退订。
- `contributions` 是别的插件交来的视图块（可选）；引擎组合后才画。
- 增量走 event：`{"topic": "ui.snapshot", "payload": {"page": "ideas", "version": 13, "base": 12, "ops": [...]}}`。
- 客户端只在 `base` 等于自己当前版本时应用；不匹配、或遇到不认识的 op，就发一次 `ui.render` 求全量。
  **永远有全量兜底**，补丁是加速不是唯一路径。
- op 最小集，路径从快照根算：

| op       | 形状                                                                                 | 做什么                |
| -------- | ------------------------------------------------------------------------------------ | --------------------- |
| `set`    | `{"op": "set", "path": ["content", "children", 0, "props", "text"], "value": "..."}` | 改一个字段            |
| `insert` | `{"op": "insert", "path": ["content", "children", 1], "index": 0, "value": {节点}}`  | children 里插一个节点 |
| `remove` | `{"op": "remove", "path": ["content", "children", 1], "index": 0}`                   | children 里删一个节点 |

- 值得做的理由在 §0：500 条页面全量 124 KiB / 3ms，增量 127 字节。
- **补丁只省解析，不自动省渲染**：渲染端必须按节点 memo（同一份节点数据引用相等就跳过重画），
  否则解析省了、重画没省。两件事一起做，少一件都不算做完。

### 6.1 视图只有一个出口

- `ui.render` 的 result 是**全量快照**（首屏 / 客户端主动要）。这是唯一一处"快照搭 result 的车"。
- 除此之外，视图变化一律走 `ui.snapshot` event：能 diff 就带补丁，不能 diff（换页、版本对不上）
  就带全量。用户事件（`ui.event`）的 result 只有确认（`{}`），不带视图。
- 客户端因此只有一条更新路径：收到 `payload.content` 就整棵替换，收到 `payload.ops` 就按补丁改。
  不存在"result 里也可能是视图"的分支。
- 顺序由 §4 保证：同一次调用触发的 event 排在它的 result 之后，客户端不会在确认之前处理视图。

## 7. HTTP 媒体通道（音频与视频）

音频和视频都走同一条 HTTP 通道，帧协议只传 media id。原因是体积：base64 会让字节涨三分之一，
还得整段塞进 JSON；十分钟的录音按 base64 就是一个几 MB 的帧，二十分钟更别提。
（v0 的 `audio_capture` 走后一条路还能跑，是因为当时只按秒数级别用；改成不限时长之后必须换。）

- 实现：net 插件（它持有 socket）。存盘仍归 media 插件，net 只按服务名转发。
- 地址：`http://<host>:<media_port>/media`，端口由 `[net] media_port` 决定（0 = 由系统分配）。
  `net.media_url` 是唯一一处拼这个地址的地方；video 插件问它要，拿不到就不出捕捉条。
- `POST /media`：`Content-Type` 必须是 `audio/*` 或 `video/*`，必须带 `Content-Length`；
  成功回 `201 {"media_id": "..."}`。
- `GET /media/{id}`：回原始字节与该媒体的 `Content-Type`。
- CORS：只回 `[net] media_origins` 里列出的 origin（默认是 Vite dev 的两个），`OPTIONS` 回 204。
- 错误：`400`（请求体坏了 / 空媒体）、`404`（没有这个媒体或路由）、`411`（缺 `Content-Length`）、
  `413`（超过 `[media] max_mb`）、`415`（不是音频或视频）、`503`（media 服务没装）。

当前协议的边界：没有鉴权；绑定地址跟 `[net] host` 一致（默认只听 127.0.0.1）；没有分块传输、
没有 keep-alive、没有 Range（视频不能拖进度）、没有并发上限、没有压缩或转码。
放到局域网 / 公网之前必须补鉴权。

## 8. 指标

`call {"target": "net", "method": "stats"}` 回：

```json
{
  "connections": 1,
  "calls": 1234,
  "frames_out": 5678,
  "bytes_out": 901234,
  "queue_depth": 0,
  "dropped": 0,
  "slow_calls": [{ "target": "ui", "method": "render", "ms": 12.3 }]
}
```

没有这个，任何"性能提升"都无法验收。开发面板与日志读它，不靠感觉。

## 9. 不做（以及为什么）

- **换传输**：UDS / named pipe（渲染引擎在 Chromium 里，拿不到）；HTTP/3 / WebTransport（要 TLS 与
  QUIC 栈，本机收益为 0）；WebRTC（信令与 SDP 的成本，换一个本机不存在的丢包问题）；
  SSE（单向，还要多一条连接、多一套错误处理）。
- **二进制帧 / msgpack 全量化**：省 26% 字节、编解码快约 2x，但快照只占环节里的一部分，
  换来不可 grep 的线上格式，不划算。等真有高频数值流（波形、进度、计时），再单开"高频小帧走二进制"一格。
- **protobuf / codegen**：一份 `.proto` 加两套生成器，换掉的是一份已经能被跨语言 fixture 钉住的 JSON。
  等协议大到手写会错时再说。
- **反向 RPC 的 Python API**：帧已经允许 call 双向，但 Python 服务方法同步，里面不能 await 一次跨进程往返。
  要做，门槛是"服务方法可以是 async"或"TS 宿主有服务表"，等第一个真需求。
- **版本协商、多客户端路由、topic 通配、鉴权、大帧分片**。

## 10. 跨语言钉

`app/sdk/tests/fixtures/protocol.json` 是唯一的跨语言样例，Python 与 TS 的测试都读它：

- `calls`：call 帧，合法与非法都要有（含 `net.subscribe`）；
- `events`：event 帧，合法与非法都要有（含未知 topic 的合法帧）；
- `snapshots`：页面快照，钉字段（`pages` / `page` / `meta` / `content` / `version`）与节点形状；
- 补丁不是封套：op 的形状由 `render/patch.ts` 与 ui 插件的测试钉住，不进协议 fixture。

Python 用 SDK 的 `serialize` 输出和 `snapshots` 里的 `content` 逐字段比对；TS 检查同一份快照与补丁的形状。
两边都不自己造样例。

# 协议设计

两个 runtime 之间只有这一条协议。**形状是合同**：写在这里，Python 与 TS 各实现一份，用同一份 fixture 钉住。
实现它的是 net 插件（见 `app/packages/net/`）；内核不认识帧。

## 1. 传输

- WebSocket，文本帧，一条消息一帧 JSON。
- 默认 `ws://127.0.0.1:8765`，地址由 `config.ini` 的 `[net]` 决定。
- 只收文本帧；收到二进制帧回 `bad_frame`。
- 媒体字节还有一条旁路：音频与视频都走 HTTP 媒体通道（§7），帧里只传 media id。

## 2. 三种帧

```
call   {"id": "1", "type": "call",   "target": "ui", "method": "render", "args": {"page": "ideas"}}
result {"id": "1", "type": "result", "value": {...}}
error  {"id": "1", "type": "error",  "code": "unknown_target", "message": "服务未提供: x"}
```

规矩：

- `id` 必须是非空字符串，结果帧原样回填；`bad_frame` 时允许为 `null`（帧都没解析出来）。
- `args` 必须是对象；缺省按 `{}`。
- 一次调用一帧结果，没有流式、没有推送。
- 页面快照放在 `result.value` 里（形状见 §5），不单独发明帧类型。

## 3. 错误码

| code             | 什么时候                                                                                  |
| ---------------- | ----------------------------------------------------------------------------------------- |
| `bad_frame`      | JSON 不合法、不是对象、缺 `id` / `target` / `method`、`type` 不是 `call`、`args` 不是对象 |
| `unknown_target` | 这个名字没有服务                                                                          |
| `unknown_method` | 服务没有这个方法，或它不是可调用的                                                        |
| `call_failed`    | 方法抛了异常；`message` 是 `str(exc)`，不带 traceback                                     |

## 4. 方向与并发

- v0 只有上行：TS 调 Python。下行只通过 `result` 回来。
- 服务方法全是同步的，在事件循环里内联调用；net 对每个连接**一帧处理完再处理下一帧**。
  因此服务不会被并发调用，插件不需要加锁。
- 什么时候回帧、能不能主动推，都是 net 的职责；v0 不推送。

### 4.1 插件管理调用

manager 是普通服务，不新增帧类型：

| 调用                          | args                                  | 返回     |
| ----------------------------- | ------------------------------------- | -------- |
| `manager.inventory`           | `{}`                                  | 清单快照 |
| `manager.report_capabilities` | `{"capabilities": ["microphone"]}`    | 清单快照 |
| `manager.set_enabled`         | `{"name": "ideas", "enabled": false}` | 清单快照 |

能力是客户端的事实：引擎在连接 open 后上报一次，Python 侧不探测硬件。

## 5. 页面快照与节点

`ui.render` / `ui.event` 的 `result.value` 是一份页面快照：

```json
{
  "pages": [{ "name": "ideas", "label": "灵感", "count": 3 }],
  "page": "ideas",
  "meta": "3 条",
  "content": { "type": "column", "props": {}, "children": [] }
}
```

- `pages` 是导航：名字、标签、可选数量，按登记顺序。
- `page` 是当前页；`meta` 是标题旁那句话；`content` 是节点树。

节点：

```json
{
  "type": "column",
  "props": {},
  "children": [{ "type": "text", "props": { "text": "灵感", "kind": "title" }, "children": [] }]
}
```

- `children` 永远是数组，没有子节点就是 `[]`。
- 可调用字段（如 `on_click`、`on_submit`）序列化成 handler id 字符串，对渲染引擎不透明。
- 组件词表：`column` / `row` / `text` / `button` / `input` / `recorder` / `audio` /
  `audio_capture` / `video_capture` / `video` / `hotkey` / `waveform` / `list` / `item` /
  `empty` / `search` / `suggestion` / `result`。
- `recorder` 与 `audio` 是 v0 的形状，保留：老快照照样能画。新捕捉用
  `audio_capture`（audio 插件给）和 `video_capture`（video 插件给）。
- 事件载荷：`{"handler": "...", "payload": {...}}`；`input` 提交带 `{"value": "..."}`，
  `audio_capture` / `video_capture` 带 `{"media": "media id", "mime": "...", "seconds": 0.0}`，
  `button` 带 `{}`。波形不进载荷：`waveform` 节点只给媒体地址，渲染引擎自己去取。
  `hotkey` 按下 / 松开都带 `{}`。
- 搜索：`search` 的 children 是 `suggestion`；打字事件与提交事件都带 `{"value": "..."}`，
  点一条建议带回那条建议自己的 `value`，点 `result` 带 `{}`。`suggestion` 与 `result` 的
  `highlight` 是"要把哪几个字标出来"，渲染引擎不认识它是不是真的命中。
- 媒体字节不走帧：音频与视频都走 §7 的 HTTP 媒体通道，帧里只有 media id。
  例外是播放：`media.load` 仍然把字节按 base64 返回（v0 的形状，保留）。只收文本帧的规矩不变。
- 未知 `type` → 渲染引擎画占位框，不崩。

## 6. 跨语言钉

`app/sdk/tests/fixtures/protocol.json` 是唯一的跨语言样例，Python 与 TS 的测试都读它：

- `calls`：call 帧，合法与非法都要有；
- `snapshots`：页面快照，钉字段（`pages` / `page` / `meta` / `content`）与节点形状。

Python 用 SDK 的 `serialize` 输出和 `snapshots` 里的 `content` 逐字段比对；TS 检查同一份
快照的节点形状。两边都不自己造样例。

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

v0 的边界：没有鉴权；绑定地址跟 `[net] host` 一致（默认只听 127.0.0.1）；没有分块传输、
没有 keep-alive、没有 Range（视频不能拖进度）、没有并发上限、没有压缩或转码。
放到局域网 / 公网之前必须补鉴权。

## 8. 不做

推送、二进制帧、超时、重连、多客户端、增量更新；媒体通道的鉴权、Range 与分块传输。

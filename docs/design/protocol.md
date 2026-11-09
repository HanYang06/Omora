# 协议设计

两个 runtime 之间只有这一条协议。**形状是合同**：写在这里，Python 与 TS 各实现一份，用同一份 fixture 钉住。
实现它的是 net 插件（见 `app/packages/net/`）；内核不认识帧。

## 1. 传输

- WebSocket，文本帧，一条消息一帧 JSON。
- 默认 `ws://127.0.0.1:8765`，地址由 `config.ini` 的 `[net]` 决定。
- 只收文本帧；收到二进制帧回 `bad_frame`。

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

| code | 什么时候 |
|---|---|
| `bad_frame` | JSON 不合法、不是对象、缺 `id` / `target` / `method`、`type` 不是 `call`、`args` 不是对象 |
| `unknown_target` | 这个名字没有服务 |
| `unknown_method` | 服务没有这个方法，或它不是可调用的 |
| `call_failed` | 方法抛了异常；`message` 是 `str(exc)`，不带 traceback |

## 4. 方向与并发

- v0 只有上行：TS 调 Python。下行只通过 `result` 回来。
- 服务方法全是同步的，在事件循环里内联调用；net 对每个连接**一帧处理完再处理下一帧**。
  因此服务不会被并发调用，插件不需要加锁。
- 什么时候回帧、能不能主动推，都是 net 的职责；v0 不推送。

## 5. 页面快照与节点

`ui.render` / `ui.event` 的 `result.value` 是一份页面快照：

```json
{
  "pages": [{"name": "ideas", "label": "灵感", "count": 3}],
  "page": "ideas",
  "meta": "3 条",
  "content": {"type": "column", "props": {}, "children": []}
}
```

- `pages` 是导航：名字、标签、可选数量，按登记顺序。
- `page` 是当前页；`meta` 是标题旁那句话；`content` 是节点树。

节点：

```json
{"type": "column", "props": {}, "children": [
  {"type": "text", "props": {"text": "灵感", "kind": "title"}, "children": []}
]}
```

- `children` 永远是数组，没有子节点就是 `[]`。
- 可调用字段（如 `on_click`、`on_submit`）序列化成 handler id 字符串，对渲染引擎不透明。
- 组件词表：`column` / `row` / `text` / `button` / `input` / `recorder` / `audio` / `list` / `item` / `empty`。
- 事件载荷：`{"handler": "...", "payload": {...}}`；`input` 提交带 `{"value": "..."}`，`recorder` 带 `{"audio": base64, "mime": "...", "seconds": 0}`，`button` 带 `{}`。
- 媒体字节在 v0 走 base64（`recorder` 的载荷、`media.load` 的返回值）；只收文本帧的规矩不变。
- 未知 `type` → 渲染引擎画占位框，不崩。

## 6. 跨语言钉

`app/sdk/tests/fixtures/protocol.json` 是唯一的一份帧样例，Python 与 TS 的测试都读它。

## 7. 不做

推送、二进制帧、超时、重连、多客户端、增量更新。

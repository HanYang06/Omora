# 线上形状：文档、更新与数据

> 状态：**提案**（S1 落定后转为已定未实现）。
> 依赖：[contract.md](contract.md) · [addressing.md](addressing.md) · [updates.md](updates.md) · [collection.md](collection.md)
> 相关：[docs/design/protocol.md](../design/protocol.md)（帧、传输、订阅）

## 0. 范围

本文只写 **Dendrolink 的 payload 形状**：文档、局部树登记、数据更新、操作。帧类型、连接、订阅、错误帧仍归 [协议设计](../design/protocol.md)；不新增帧类型。

## 1. schema 与版本

- 文档信封带 `"schema": "dendro.ui/2"`。
- 文档版本单调递增；每个更新带 `base` 与 `seq`。
- 数据源有独立 `revision`，同 revision 幂等。
- 版本对不上时客户端请求全量；“永远有全量兜底”保持不变。

## 2. 全量文档

```jsonc
{
  "schema": "dendro.ui/2",
  "document": { "id": "dendro.window", "kind": "dendro:window", "children": [] },
  "pages": [{ "id": "page.ideas", "label": "灵感", "route": "/ideas", "owner": "ideas" }],
  "active": "page.ideas",
  "data": {
    "ideas.feed": { "revision": 5, "items": [{ "id": "42", "template": "item" }] },
  },
  "version": 17,
}
```

- `document` 是权威根树的序列化；组合与派生已完成，客户端只应用。
- `data` 是当前数据文档的投影；集合条目不内联进树。

## 3. 局部树登记 / 全量重组

来源登记自己的局部树；全量更新重交整组：

```jsonc
{
  "kind": "local-trees",
  "seq": 3,
  "trees": [
    { "owner": "ideas", "root": {}, "mountAt": "dendro.window.page", "order": 10 },
    { "owner": "projects", "root": {}, "mountAt": "dendro.window.nav", "order": 20 },
  ],
}
```

引擎编译/链接后产出新文档；失败则保留上一棵合法文档并回诊断。

## 4. 数据更新

标量：

```jsonc
{
  "kind": "data",
  "owner": "net",
  "source": "session.status",
  "revision": 8,
  "value": { "connected": true },
}
```

集合：

```jsonc
{
  "kind": "data",
  "owner": "ideas",
  "source": "ideas.feed",
  "revision": 6,
  "changes": [{ "kind": "insert", "key": "43", "at": 0, "item": { "id": "43" } }],
}
```

## 5. 更新操作

```jsonc
{
  "kind": "ops",
  "document": 17,
  "base": 16,
  "seq": 42,
  "ops": [
    { "op": "update", "id": "ideas.search", "props": { "value": "录音" } },
    { "op": "mount", "slot": "ideas.feed", "at": 0, "node": {} },
    { "op": "move", "id": "ideas.feed#42", "slot": "ideas.rail", "at": 3 },
    { "op": "unmount", "id": "ideas.feed#7" },
    { "op": "replace", "id": "ideas.main", "node": {} },
    { "op": "route", "page": "page.detail", "params": { "id": "42" } },
  ],
}
```

| op        | 目标    | 语义                                    |
| --------- | ------- | --------------------------------------- |
| `update`  | id      | 改 props / 数据 / 局部状态              |
| `mount`   | slot id | 在指定位置插一棵子树                    |
| `move`    | id      | 改变父/槽位/顺序                        |
| `unmount` | id      | 删除子树并跑清理                        |
| `replace` | id      | 整棵替换                                |
| `route`   | page    | 路由意图；由引擎展开成 page slot 的协调 |
| `data`    | source  | 数据更新（见 `4）                       |

## 6. 诊断与错误

- 编译/链接诊断码见 [composition.md](composition.md)；运行期诊断用同一套码。
- 非法更新用 `error` 帧回；`code` 用诊断码或协议错误码，`message` 给人看。
- 诊断不得让连接断开或根树失效。

## 7. 与现有协议的关系

- 仍只有 `call / result / error / event` 四种帧。
- v1 的 `ui.render` / `ui.event` / `ui.snapshot` 语义保留：全量走 render，变化走 snapshot，事件走 event。
- 变化只是 payload 从“页面快照 + 路径补丁”变成“文档 + 按 id 的更新”。

## 8. 未定

- 首次连接是否需要 schema 握手；
- 大文档的分块传输；
- 多客户端会话标识是否进帧。

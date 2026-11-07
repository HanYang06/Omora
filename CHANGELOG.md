# Changelog

所有包同号发布（见 [ADR-0003](docs/decisions/0003-unified-versioning.md)）。
每条记录必须包含「契约」段：本次发布是否动了 C1 / C2 / C3，没动就写「无变化」。

## 0.1.0 — 未发布

### 契约

- C3 节点从最小骨架扩到六节点：`Stack` `Text` `Button` `Input` `List` `Card`；事件只允许指向命令，`$` 前缀表示数据绑定，未知字段一律拒绝。
- 新增 C2 清单 schema：`id` `version` `engines` `runtime` `entry` `activation` `capabilities` `contributes`。
- 新增 C1 帧 schema：`state.snapshot` `cmd.invoke` `query.invoke` `event.subscribe` `ping`，以及下行 `event` 通知；错误码收敛为 `E_INVALID` `E_DENIED` `E_UNAVAILABLE` `E_INTERNAL`。
- `state.snapshot` 的返回补上 `ui` 槽位投影：槽位名 → 贡献列表（`owner` + 节点树）；`state` 明确以插件 id 为键。
- C2 能力在运行期强制：清单未声明的能力被调用时返回 `E_DENIED`（此前只校验声明、不拦截调用）。
- C2 能力目录新增 `services`：提供或消费跨插件服务的插件必须声明。
- 错误响应的 `id` 允许 `null`（请求 id 无法解析时），成功响应仍必须是字符串或整数。
- 下行 `event` 通知可携带 `owner` 与 `state`（折叠后的完整切片），让前端不必懂业务规则就能更新投影；补发事件不带这两项。
- 新增生成物 `protocol/generated/contract.ts`，门禁新增 `contract.types` 阶段：重新生成后 diff 必须为空。

### 工程

- 契约测试改为 fixture 驱动：每个 schema 都必须有合法与非法样本，新增 schema 不加样本直接失败。

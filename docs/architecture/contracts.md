# 三份契约

> 状态：草稿。P0 只需实现标注 P0 的部分。

## 0. 总则

### 0.1 为什么不合并成一份

混成一份，会同时失去三样东西：内部重构的自由、插件的权限边界、UI 插件的语言中立。三者的兼容承诺不同，必须分开。

### 0.2 传输与编码

- 传输：P0 用本机回环 WebSocket；后续可换 Unix socket / stdio，契约不变。
- 编码：JSON；消息量上来后可协商 MessagePack，属于传输参数，不是契约变更。
- 帧格式：JSON-RPC 2.0。

### 0.3 版本与能力探测

- 每次连接先握手，交换 `omora_version` 与 `capabilities`。
- 未知能力 = 降级，不是报错。
- C2 / C3 只做加法；破坏性变更走主版本号。

### 0.4 错误模型

```json
{ "code": "E_CAPABILITY_DENIED", "message": "...", "data": { "capability": "storage" } }
```

错误码四类：`E_INVALID`（参数）、`E_DENIED`（权限）、`E_UNAVAILABLE`（依赖缺失）、`E_INTERNAL`（宿主缺陷）。

### 0.5 版本策略：统一发布，语义即承诺

仓库内所有包同号发布。不存在 C1 / C2 / C3 各自的版本号——版本号只有一个，兼容性由语义化版本规则承载：

| 变更类型 | 版本位 | 契约影响 |
|---|---|---|
| 修 bug、改文案、内部重构 | PATCH | 契约不变 |
| 新增节点类型、能力、方法 | MINOR | 契约只加不改 |
| 删除、重命名、改语义 | MAJOR | 契约可破 |

规则：

- **主版本号只用于契约破坏**，不用于产品营销。
- 插件清单里的 `engines` 声明它对宿主版本的范围，宿主加载时做 semver 校验。
- 第三方插件有自己的版本，不受统一版本约束。
- 每次发布是否动了契约，记录在 changelog 的 contract 段——不再另开一个版本号。

## 1. C1：内核 ↔ 前端（私有）

唯一规则：**它随时可以破坏。** 不要把它当公开 API，也不要为了兼容它而牺牲内部设计。

### 1.1 方法

| 方法 | 方向 | 说明 |
|---|---|---|
| state.snapshot | UI → 内核 | 取全量投影 + revision |
| cmd.invoke | UI → 内核 | 执行命令 |
| query.invoke | UI → 内核 | 只读查询 |
| event.subscribe | UI → 内核 | 订阅增量事件流 |
| ping | 双向 | 存活检测 |

### 1.2 示例

```json
{ "jsonrpc": "2.0", "id": 1, "method": "cmd.invoke",
  "params": { "name": "ideas.create", "args": { "title": "把协议写下来" } } }
```

```json
{ "jsonrpc": "2.0", "id": 1, "result": { "id": "01J..." } }
```

```json
{ "jsonrpc": "2.0", "method": "event",
  "params": { "type": "idea.created", "revision": 42,
              "data": { "id": "01J...", "title": "..." } } }
```

### 1.3 规则

- 命令必须幂等，或携带幂等键；
- 事件必须带单调递增 `revision`，UI 用它做去重与断线追赶；
- 大批量读取走分页，不走聊天式往返；
- UI 不做业务判断，只做展示态与临时交互态。

## 2. C2：宿主 ↔ 插件（公开）

### 2.1 清单

```json
{
  "id": "org.example.ideas",
  "name": "Ideas",
  "version": "0.1.0",
  "engines": { "omora": "^0.3" },
  "runtime": "python",
  "entry": "omora_ideas:plugin",
  "activation": ["onStartup", "onCommand:ideas.new"],
  "capabilities": ["storage", "ui", "commands"],
  "contributes": {
    "commands": [{ "id": "ideas.new", "title": "新建灵感" }],
    "slots": [{ "id": "ideas.board", "slot": "main" }]
  }
}
```

清单里的 `engines` 对齐的是本产品版本。统一版本之下，这就是插件唯一需要声明的兼容范围；宿主按语义化版本规则校验。

### 2.2 生命周期

`discover → validate → resolve → activate → running → deactivate → dispose`

- 激活事件决定何时加载：`onStartup` / `onCommand:` / `onEvent:` / `onSlot:`。
- 安装 ≠ 激活。装一百个插件，常驻的可以只有三个。
- 每个插件持有一个 scope；它注册的一切（命令、槽位、订阅、定时器）都挂在 scope 上，dispose 时精确回收。

### 2.3 宿主 → 插件

| 方法 | 说明 |
|---|---|
| plugin.activate | 传入配置与授权 |
| plugin.deactivate | 卸载原因 |
| plugin.render | 请求某槽位的节点树 |
| service.call | 调用插件提供的服务 |
| event.deliver | 投递事件 |
| health.ping | 存活与资源上报 |

### 2.4 插件 → 宿主

| 方法 | 说明 |
|---|---|
| host.call | 调用内核能力 |
| host.contribute | 贡献或更新 UI |
| host.emit | 发布事件 |
| host.log | 日志与指标 |

### 2.5 能力目录（内核授予）

`storage` `events` `ui` `commands` `settings` `fs` `net` `secrets` `clipboard` `notifications` `jobs` `log`

### 2.6 服务目录（插件提供）

`git` `ai` `search` 等由官方插件提供并注册，其他插件通过 `service.call` 消费。**核心不实现任何服务。**

### 2.7 规则

- 插件永远不知道其他插件的存在；跨插件只走服务注册表；
- 能力在激活时一次性授予，运行期不可扩权；
- 同一插件在 L0–L5 协议一致，宿主可无损迁移其承载层级。

## 3. C3：插件 ↔ 渲染器（公开数据 ABI）

### 3.1 节点

```json
{ "type": "Stack", "props": { "direction": "vertical", "gap": 8 },
  "children": [
    { "type": "Text", "props": { "text": "$idea.title", "variant": "title" } },
    { "type": "Button", "props": { "label": "打开" },
      "on": { "click": { "command": "ideas.open", "args": { "id": "$idea.id" } } } }
  ]
}
```

- `type` 必须在渲染器的组件词表内，否则降级为占位符；
- `props` 只接受该类型声明的属性；
- `$` 开头是数据绑定，作用域由宿主按槽位提供；
- `on` 只能指向命令，不能内联逻辑。

### 3.2 槽位

`sidebar` `main` `panel` `detail` `statusbar` `commandPalette` `settings` `onboarding` `modal`

槽位是「插件能改 UI」的机制底座：插件不改布局，只往已有槽位里填内容。

### 3.3 主题

只允许引用 token，不允许写颜色值与样式表：

`--omora-color-*` `--omora-space-*` `--omora-radius-*` `--omora-font-*` `--omora-shadow-*`

### 3.4 兼容

- 握手时上报 `omora_version` 与 `ui_capabilities`；
- 新增节点类型随 MINOR 发布，修改语义随 MAJOR 发布；
- 渲染器对未知 `type` 必须降级，不得崩溃。

### 3.5 规则

- 禁止注入 HTML / CSS / 脚本；
- 禁止直接访问存储与内核状态，只能通过绑定与命令；
- 表达式保持无副作用，复杂计算回内核做。

## 4. P0 最小集合

| 契约 | P0 实现 |
|---|---|
| C1 | `state.snapshot` `cmd.invoke` `query.invoke` `event.subscribe` |
| C2 | `plugin.activate` `plugin.deactivate` `plugin.render` `host.call` `host.contribute` |
| C3 | `Stack` `Text` `Button` `Input` `List` `Card` 六个节点 + `main` `sidebar` 两个槽位 |

# 渲染引擎设计

位置：`app/ui-engine/`。职责：把节点树画出来，把交互发回去。它不持有真相。

## 1. 技术

TypeScript + React + Vite。

## 2. 结构

```
src/
  main.tsx        挂载
  app.tsx         容器：快照 + 连接状态；连上 render，点导航 render，回车 / 动作 event，播放取媒体
  shell.tsx       默认母页面：左侧导航 + 右侧一页纸
  connection.ts   WebSocket：请求 / 响应按 id 配对；未连接不发请求
  protocol.ts     帧的类型与校验（读同一份 fixture）
  renderer.tsx    节点树 → React；未知 type 画占位框
  components.tsx  基础词表（column / row / text / button / input / list / item / empty）+ 注册表
  capture.tsx     录音 / 播放
  media.ts        取媒体（media.load，参数名 media_id）
  shared.ts       组件共用的 props 与工具
  types.ts        节点、页面快照、媒体、handler 类型
  styles.css      壳与基础词表
  media.css       录音 / 播放
  *.test.ts(x)    vitest：协议、连接、渲染、母页面
```

测试：`pnpm --dir app/ui-engine test --run`。协议测试读 `app/sdk/tests/fixtures/protocol.json`——Python 与 TS 用同一份帧样例。

## 3. 连接

- 连 net 插件提供的端点；默认 `ws://127.0.0.1:8765`（`connection.ts` 的 `DEFAULT_URL`），由 net 的配置决定实际地址。
- 请求 `{id, target, method, args}`；响应按 `id` 配对成 Promise。
- 未连接或断开：页面显示状态，不发请求。
- v0 不做重连与超时。

## 4. 数据流

1. 连上 → `ui.render({})` → `result` 是页面快照 → `setState`。
2. 渲染：`Shell` 用 `pages` 画导航、`page` 高亮、`label` + `meta` 画标题，`content` 画页面。
3. 点导航 → 引擎直接发 `ui.render({page})`，不走事件。
4. 捕捉：
   - 打字回车 → `ui.event({handler, payload: {value}})`；
   - 录音停 → `ui.event({handler, payload: {audio, mime, seconds}})`，`audio` 是 base64。
5. 点动作 → `ui.event({handler, payload: {}})`；返回同一份快照，整页替换。
6. 播放音频 → `media.load({media_id})` → `{mime, data(base64)}` → 引擎按需播；音频字节不进快照。参数名要和 Python 的 `load(media_id)` 对齐。

## 5. 页面快照

```json
{
  "pages": [{"name": "ideas", "label": "灵感", "count": 3}],
  "page": "ideas",
  "meta": "3 条",
  "content": {"type": "column", "props": {}, "children": []}
}
```

- `pages` 是导航：名字、标签、可选数量，按登记顺序。
- `page` 是当前页；`meta` 是标题旁那句话。
- `content` 是节点树；媒体只放 id，不放字节。

## 6. 母页面与槽位

- 默认母页面 = `shell.tsx`：侧栏骨架（引擎画）+ 导航（插件登记）+ 页面（插件填）。
- 两个槽位：`nav`（页面的 name / label / count）和 `page`（当前页内容）。
- 侧栏顶部留白：名字 / Logo 未定，设计不依赖它。
- 以后要常驻辅助栏，再开第三个槽。

## 7. 组件

| type | props | 渲染 |
|---|---|---|
| column | — | 纵向 flex |
| row | — | 横向 flex |
| text | text、kind? | span；kind 只映射样式类（title / muted / 默认） |
| button | text、on_click、variant? | button；点击发事件；variant = ghost 时是列表行里的文字动作 |
| input | placeholder、on_submit | 捕捉行：回车把值塞进事件载荷，然后清空自己 |
| recorder | on_submit | 录音条：点一下录，再点一下停；停后把 base64 音频交给事件 |
| audio | media | 播放按钮：点的时候按需向 media 服务取，不预载 |
| list | — | 账本容器（ul） |
| item | meta、title | 账本行：左栏 meta、右栏标题、子节点是这一行的动作 |
| empty | title、hint? | 空状态；没有 hint 就不画第二行 |

- 未知 `type` → 占位框 + `console.warn`。
- 没有子节点的 `children` 也得是数组。

## 8. 主题

- 只实现了浅色主题：橄榄灰桌面 + 暖白纸，一条发丝缝分开。
- 深色主题**单独设计**，不是浅色的反相；没设计之前不实现，也不做自动暗色。

## 9. 状态

- 只持有两样：当前快照、连接状态。
- 不缓存真相：数据在 Python 侧，这里只有当前这一份快照。
- 媒体按需取、按需播；不把字节塞进快照。

## 10. 错误

- 错误帧：`console.error`，保留旧快照，不改界面。
- 渲染异常：v0 不加错误边界；崩了刷新。

## 11. 不变量

- 不认识 Python 服务之外的领域。
- 不做业务判断：点按钮就发事件，不自己改数据。
- 不 import Python 侧任何东西。
- 只认 `{type, props, children}`、页面快照与 handler id。
- 只跟 net 插件说话；net 是系统插件，不属于内核。

## 12. 没做的

- TS 插件宿主（接管整个界面的那一层）。
- 深色主题。
- 视频捕获、HTTP 媒体通道（v0 音频走 base64）。
- 本地转写 / AI 解读。
- 关联 / 网图、详情页、局部更新 / diff。
- 重连、请求超时、多客户端、窄屏适配。

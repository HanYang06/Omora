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
  capability-report.ts  连上后把客户端能力报给 manager（检测在 capture 的 devices.ts）
  protocol.ts     帧的类型与校验（读同一份 fixture）
  renderer.tsx    节点树 → React；未知 type 画占位框
  components.tsx  基础词表（column / row / text / button / input / list / item / empty）+ 注册表
  capture.tsx     老录音条 / 音频播放（v0 形状，保留）
  audio-capture.tsx  音频捕捉：设备门禁、多设备、录音
  video-capture.tsx  视频捕捉：设备门禁、预览、重录、上传；加视频播放器
  devices.ts      设备检测：枚举、门禁、热插拔、能力上报（纯函数，可直接测）
  use-devices.ts  设备状态的 React 胶水
  device-select.tsx  多设备时的选择器
  media.ts        取媒体（media.load）+ 上传（HTTP 媒体通道）
  shared.ts       组件共用的 props 与工具
  search.tsx      搜索框、建议、结果
  searchText.ts   命中切分与键盘决策（纯函数）
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

1. 连上 → `manager.report_capabilities({capabilities})` 上报本客户端能力，然后
   `ui.render({})` → `result` 是页面快照 → `setState`。
2. 渲染：`Shell` 用 `pages` 画导航、`page` 高亮、`label` + `meta` 画标题，`content` 画页面。
3. 点导航 → 引擎直接发 `ui.render({page})`，不走事件。
4. 捕捉：
   - 打字回车 → `ui.event({handler, payload: {value}})`；
   - 录音停 → 自动 `POST` 到媒体通道拿 media id → `ui.event({handler, payload: {media, mime, seconds, peaks}})`；
     `peaks` 是录制中顺手采的波形（0–100 的整数，最多 300 个）。音频不再走 base64：
     十分钟的录音按 base64 会撑爆一个帧。
   - 录像停 → 同样先 `POST` 拿 media id → `ui.event({handler, payload: {media, mime, seconds}})`；
     没有「回看再确认」这一步。
   - 组件卸载时如果还在录，也要停止并把这段交出去（录了即存，见 [捕捉工作区](../design/ui-capture.md)）。
5. 设备：引擎一挂上就 `enumerateDevices`，之后跟着 `devicechange` 重新枚举；没有对应设备
   （或还没有权限、还没枚举完）就把捕捉按钮禁用，并把原因写在旁边。`getUserMedia` 只在
   用户点按钮那一下调——权限只在手势里给。多设备给选择器，选中的 deviceId 进 constraints。
   插拔设备不需要刷新页面。
6. 点动作 → `ui.event({handler, payload: {}})`；返回同一份快照，整页替换。
7. 播放音频 → `media.load({media_id})` → `{mime, data(base64)}` → 引擎按需播；音频字节不进快照。参数名要和 Python 的 `load(media_id)` 对齐。
   播放视频 → 节点里只有 `src`（媒体通道地址），`<video src>` 自己取字节，不要走 base64。
8. 搜索：打字在引擎侧防抖 200ms → `ui.event({handler, payload: {value}})`；建议是
   `search` 的子节点，画成下拉。回车在没有选中建议时提交输入框里的字，有选中建议时
   把那一条的 `value` 交回去；上下键只在建议之间走（到头就停），Esc 只收下拉、不提交。
   下拉开不开、建议几条、提交后去哪一屏，全由插件返回的下一次快照决定。

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
| input | placeholder、value?、on_submit | 一行输入：回车把值塞进事件载荷；`value` 用于预填（改名），用户改过就以用户为准 |
| recorder | on_submit | 录音条：点一下录，再点一下停；停后把 base64 音频交给事件 |
| audio | media | 播放按钮：点的时候按需向 media 服务取，不预载 |
| audio_capture | on_submit、upload_url、quality?、noise_reduction?、max_seconds?、autostart?、pausable? | 录音主体：门禁 + 多设备 + 实时波形 + 暂停；停即上传即提交。`max_seconds=0` 不限，`autostart` 一挂上就录 |
| video_capture | on_submit、upload_url、quality?、max_seconds?、pausable? | 视频主体：门禁 + 实时预览 + 暂停；停止即上传并提交，上传失败给重试 |
| video | media、src? | 视频播放器；`src` 是媒体通道地址，没有就写"媒体通道未就绪" |
| hotkey | key、on_press、on_release | 不画东西，只在 document 上挂监听：按下发 on_press，松开发 on_release（焦点在输入框里不触发） |
| waveform | peaks、seconds | 静态波形：peaks 是 0–100 的柱高；只负责看，不负责播 |
| list | — | 账本容器（ul） |
| item | meta、title | 账本行：左栏 meta、右栏标题、子节点是这一行的动作 |
| empty | title、hint? | 空状态；没有 hint 就不画第二行 |
| search | placeholder、value、on_query、on_submit | 搜索框：防抖 200ms 问后端；children 是下拉建议；回车 / 按钮提交 |
| suggestion | value、title、meta?、highlight?、on_pick | 下拉一条：点它把 value 交回去；highlight 在 title 里标出来 |
| result | title、snippet、meta、highlight?、on_click | 结果行：标题可点；snippet 里把命中的词标出来 |

- 未知 `type` → 占位框 + `console.warn`。
- 没有子节点的 `children` 也得是数组。

## 8. 主题

- 只实现了浅色主题：橄榄灰桌面 + 暖白纸，一条发丝缝分开。
- 深色主题**单独设计**，不是浅色的反相；没设计之前不实现，也不做自动暗色。

## 9. 状态

- 只持有三样：当前快照、连接状态、本机的设备状态（设备清单 / 枚举到没有）。
- 设备能力上报一次：连接 open 后把 `detectCapabilities()` 的结果交给 manager 的
  `report_capabilities`（谁上报、怎么报是 manager 那边的事；引擎只给检测结果，不重复报）。
  设备状态是本机事实，不上报成真相：它只决定这一台机器上的按钮能不能按。
- 不缓存真相：数据在 Python 侧，这里只有当前这一份快照。
- 媒体按需取、按需播；不把字节塞进快照。

## 10. 错误

- 错误帧：`console.error`，保留旧快照，不改界面。
- 渲染异常：v0 不加错误边界；崩了刷新。

## 11. 不变量

- 不认识 Python 服务之外的领域。
- 不做业务判断：点按钮就发事件，不自己改数据。
- 不 import Python 侧任何东西。
- 客户端能力由引擎检测并上报；检测只归 capture（`devices.ts`），不重复枚举。
- 只认 `{type, props, children}`、页面快照与 handler id。
- 只跟 net 插件说话；net 是系统插件，不属于内核。

## 12. 没做的

- TS 插件宿主（接管整个界面的那一层）。
- 深色主题。
- 本地转写 / AI 解读。
- 关联 / 网图、局部更新 / diff。
- 重连、请求超时、多客户端、窄屏适配。
- 视频通道的 Range（拖进度）与鉴权；设备权限被拒后的引导。
# 渲染层：DOM renderer

> 状态：**已落**。React 已移除，38 个 kind 有 DOM 实现与测试；决策见 [ADR-0002](decisions/0002-no-react-dom-renderer.md)。
> 本文定义 kind 接口、renderer 协调规则、测试约定；协调与 Slot 桥在 `app/ui-engine/src/renderer/`，38 个 kind 在 `app/ui-engine/src/components/`，入口 / 壳 / 视图 / 预览在 `app/ui-engine/src/app/`。

## 0. 一句话

`node → DOM`，`id → element`，更新只改该改的地方；没有第二棵虚拟树。

## 1. 分层

```text
app/main             挂载 + 连接 + 快照
app/app              会话/快照 → renderer
renderer/renderer    node ↔ element 协调、挂载/更新/卸载
renderer/slot_bridge SlotNode → legacy Node 薄桥
components/*         kind → DOM（38 个）
components/registry  type → Kind 注册表
components/icons     内联图标
renderer/types       Kind / RenderContext
renderer/events      事件名 → handler id 解析（legacy 事件入口）
components/testing   测试用的 mount helper
```

`renderer/`、`components/` 与 `app/` 不依赖 React；`contract/`（协议）与 `legacy/render/`（patch / compose）保持框架无关。

## 2. Kind 接口

```ts
export interface RenderContext {
  /** 发事件回 Python：handler id + 载荷。 */
  event(handler: string, payload?: JsonObject): void;
  /** 按需取媒体（base64）。 */
  loadMedia(media: string): Promise<MediaData>;
  /** 登记本节点的卸载清理（逆序执行）。 */
  cleanup: (dispose: () => void) => void;
}

export interface Kind {
  /** 建元素；不要自己挂 children，renderer 负责。 */
  create(node: Node, ctx: RenderContext): HTMLElement;
  /** 在同一个元素上更新；没写就只重挂 children。 */
  update?(el: HTMLElement, node: Node, ctx: RenderContext): void;
  /** 自定义卸载；renderer 仍会跑 ctx.cleanup 账本。 */
  destroy?(el: HTMLElement): void;
  /**
   * 每个 children 的挂载点，按子节点下标映射；缺省 [el]。
   * 返回 null 表示不接受 children；缺的项回退到最后一个 host。
   */
  childrenHosts?(el: HTMLElement, node: Node): (HTMLElement | null)[] | null;
}
```

约定：

- 元素必须保留现有 `data-type` 与 `omora-*` class，样式表不动。
- 事件用 `ctx.event(handler, payload)`，不要直接调 Python。
- 局部状态（tabs/accordion/输入草稿等）挂在元素上或闭包里；需要清理的登记到 `ctx.cleanup`。
- 不认识的 type 由 renderer 画占位，不抛。

## 3. Renderer 协调

### 身份

- 有 `node.id` 用 id；没有时用 **父路径 + 位置** 作为临时键（legacy 兼容）。
- 同一个键、同一个 type：复用元素，调 `update`；
- 同一个键、type 变了：`destroy` 旧元素，`create` 新元素；
- 旧键消失：`destroy` + 移除；
- 新键出现：`create` + 插入到正确位置。

更新按 **引用** 短路：`node` 引用没变就整棵跳过（legacy patch 保留了未变子树的引用）。

### 跨父移动（S3-e）

renderer 维护跨渲染的 key → 元素索引（有 id 用 id；没有时用父路径 + 位置）。同一 key + 同 type 的节点**换父/换位置时复用同一个元素**：

- 复用前先 `el.remove()` 从旧父摘下；同一轮里每个旧条目最多认领一次（重复 id 防御）。
- 先按 key 构建/复用整棵新树，再统一按 `childrenHosts` 分槽安排 DOM 顺序；
- 新树里没有的旧条目才跑 `kind.destroy` + 逆序 cleanup；移动/保留的条目不跑；
- 引用不变的子树跳过 `kind.update`，但元素仍要挂到新 host；
- 无 id 节点仍按父路径 + 位置复用，换父即重建。

这条让"换页 = 按 id 协调"第一次真正保留实例：`renderer_move.test.ts` 用共享 Slot 文档 `applyFull` 换页后断言卡片 DOM 元素引用不变。

### 渲染节点统计（S5 起步）

`DomRenderer.stats` 给出最近一次 render 的 `{created, updated, reused, removed}`：created 与 reused 互补，updated 是 reused 的子集（真正执行了 `kind.update` 的部分），removed 是本次销毁的旧条目数；每次 render 清零，dispose 不参与。`DocumentView` 把 stats 与 renders 一起上报 EngineRuntime，指标侧累计 `nodesCreated/nodesUpdated/nodesReused/nodesRemoved` 与 `lastRender`。

### children

renderer 递归协调 children，按子节点下标挂到 `childrenHosts(el, node)[i]`；没声明就全挂到 `el`。

- `childrenHosts` 返回 `null` = kind 自己消费 children 数据（如 select 的选项），renderer 不挂载也不告警；没声明才默认 `[el]`。
- 多个子挂载点必须是**稳定 wrapper**（同一元素跨 update 一直存在），renderer 会在 update 后重算 hosts 并按 host 分组重排。
- kind 不要自己 append 子节点；需要多槽结构（split 的 side/main、tabs 的面板）就在 `childrenHosts` 里返回对应 wrapper。

### 失败隔离

每个 kind 的 `create/update` 外面包 try/catch：失败只把该节点换成占位（`omora-unknown`），兄弟继续；记录诊断，不抛到界面。

## 4. 焦点 / 输入

- 更新时只在值真的变了才写 `value`；元素处于聚焦状态时不要重写 `value`/`selection`。
- 输入类 kind 自己保存草稿状态；父级重排不重建元素（id/path 键保证）。
- 这一层要有真实 DOM 测试：聚焦中输入、回车提交、下拉打开/关闭、删除条目后焦点不丢。

## 5. 局部状态与清理

- 局部状态归渲染端：kind 可以在元素上存状态，或闭包持有；不要上升成全局。
- 媒体、监听、定时器统一走 `ctx.cleanup`；节点卸载/换页/连接关闭时逆序执行。
- 正在进行中的录制/上传：卸载时按现有 legacy 行为“停止并提交”，由 capture kind 自己实现。

### 隐藏 vs 卸载（v0 限制）

多槽 kind（tabs / accordion / search 下拉）v0 用 `hidden` 隐藏子节点，不卸载：更新快，但隐藏子树里的媒体、录制、定时器仍然活着。需要“收起即销毁”时，在 Kind 契约里加 mounted/active 策略，由 renderer 决定挂载，而不是让 kind 自己删子节点。这一条在接媒体/捕捉页面之前必须复核。

## 6. 测试

- 用 `jsdom`（已有 devDependency）；测试文件头写 `// @vitest-environment jsdom`。
- 统一 helper：`components/testing.ts` 提供 `mount(nodes)` → `{ root, renderer, events }`，断言 DOM 结构与事件 id。
- 每个 kind 至少：渲染出的标签/class、关键属性、事件 id、销毁清理。
- 不再用 React `renderToString`；测试从“组件渲染”改成“DOM 行为”。

## 7. kind 分组与写域

| 文件                   | kind                                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `components/layout.ts` | column / row / list / item / split / rail / panel / slot / empty / card                                                  |
| `components/basic.ts`  | text / icon / tile / chip / hotkey                                                                                       |
| `components/form.ts`   | button / input / switch / checkbox / radio / select / textarea / number_input / slider / field / button_group / progress |
| `components/nav.ts`    | tabs / accordion / search / suggestion / result                                                                          |
| `components/media.ts`  | recorder / audio / audio_capture / video_capture / video / waveform                                                      |

`components/registry.ts` 负责汇总这五个 map；各组只改自己的文件，避免冲突。

## 8. 迁移记录

React 渲染层已删除；剩下的是框架无关的纯模块与 DOM 实现：

- 旧 React 组件文件（`components.tsx` / `controls/*` / `cards/tiles/icons/waveform`）→ 已迁成 `components/*` 后删除；
- 旧 capture 组件的 React hooks → 已迁成 media kind 内部控制器后删除；保留 `devices / capture-rules / media-upload / video-quality` 纯规则（现在 `platform/capture/`）；
- `search/search.tsx` → `components/search.ts`；`searchText.ts` 保留在 `platform/search.ts`；
- `shell/shell.tsx` → `app/shell.ts`；
- `app.tsx/main.tsx` → `app/app.ts` + `app/main.ts`，`index.html` 入口已切到后者。

## 9. 静态骨架编译（构建期）

构建期编译器和运行时共用同一套 kind 与 `DomShell`（`DomShell` 随旧快照壳在 `legacy/shell.ts`，`build/` 只依赖 legacy）：不复制静态模板，也不给 kind 加第二套实现。

```text
scripts/static_ui.py            空数据跑系统插件 → src/generated/static-tree.ts（结构数据）
src/build/skeleton.ts        快照 → HTML（需要 DOM；kind 直接写 DOM）
src/build/boot-skeleton.ts   启动快照 + 贡献组合 → 首帧
src/build/node.ts            Node 宿主：jsdom 临时立 window/document，跑完还原
src/build/vite-plugin.ts     Vite adapter：只决定何时编译、注进哪里
```

- `vite.config.ts` 的插件把编译结果注入 `<div id="root">`；`vite build` 的 `dist/index.html` 和 dev server 都带首帧 HTML，浏览器不必等 JS 解释整棵树。
- 编译只产出结构，不注册事件：HTML 里的按钮是禁用态（运行时拿到静态快照时也如此），真快照到了由运行时接手。
- 运行时挂载（`DomApp.mount`）先清掉预渲染 HTML，再用同一份快照重建；v0 只保证"首帧不等 JS"，还没做 hydration——首帧 DOM 会被替换一次。
- 两道门禁：`static_ui.py --check` 查骨架数据是否最新；`skeleton_html.py` 查构建产物确实带编译后的 HTML（CI build job）。
- `vite.config.ts` import 了引擎源码，所以 `dev/build/test/preview` 统一带 `--configLoader runner`（`omora dev` 同步）；bundle loader 会把整张引擎模块图打进配置并报无扩展名 import 警告。

## 10. Slot → DOM（S3-d spike，已落）

Slot 文档/运行时产出的是 `SlotNode`，现有 DOM renderer 只认 legacy `Node` 词表。S3-d 先用**薄桥 + 命名空间别名**把 Slot 接上，不迁移 38 个 kind 的实现：

- `src/renderer/slot_bridge.ts`：`slotToNode` 只做形状搬运——`type = slot.kind`（保留命名空间），复制 id/props/children/events/layout；不展开 `collection.templates`（模板不是挂载节点，实例化归运行时）。
- `src/app/slot_registry.ts`：`slotRegistry` = 所有 legacy type 的 `dendro:<type>` 别名 + 宿主别名（`ideas:card` → legacy `card`）+ Slot 原生 kind；Slot 原生 kind 后合并，同名时 Slot 语义优先。
- `src/components/slot_kinds.ts`：Slot 原生结构 kind（`dendro:window/page/slot/layer` 按 `layout.flow` 映射到现有 `.omora-row`/`.omora-column` class；S4 起 size/gap/align/scroll 也映射到 `--dendro-*` CSS 变量与 `data-*` 属性，`[data-dendro-layout]` 样式段消费）与 `dendro:page-link`（复用壳层导航按钮样式，事件走 `handlerOf` + `ctx.event`）。
- `Node` 增加可选 `layout` 字段；`kind` 语义由注册表决定，renderer 协调逻辑不变。

**已证明**（`src/app/spike.test.ts`，共享 `document.json`）：session → 水合 → 桥 → DOM 渲染出母页面/导航/卡片；纯数据更新后同 id 卡片复用同一 DOM 元素、只改标题并新增一条；全量替换同 id 文档不重挂。换页用 `engine/document/page_switch.ts` 的 `diffPageTrees` 分类出 keep/move/replace/cancel/add。

**未接**：renderer 目前只在同一个父节点下按 id 协调，跨父的 `move` 会重建元素（换页移动的身份保留待补）；Slot 桥还没有接进 `app/app.ts` / 主入口，legacy 页面仍走 legacy 路径；`layout` 的 size/gap/align 还没落到样式。

## 11. 验收

- [x] 38 个 kind 全部有 DOM 实现与测试（`registry.test.ts` 钉住覆盖）；
- [x] React 依赖与 React 文件删除；`index.html` 入口切到 DOM；
- [x] 启动骨架由 Vite 在构建期编译进 `index.html`，产物门禁 `scripts/skeleton_html.py` 通过；
- [x] `tsc` / eslint / prettier / vitest / vite build 全绿；
- [ ] 首帧 hydration（复用预渲染 DOM，不重建）；
- [x] SlotNode 经薄桥 + 命名空间别名直接渲染；跨父 move 复用元素已接（`renderer_move.test.ts`）；
- [x] `?engine=slot` 预览入口（独立 chunk，legacy 默认路径不变）；
- [ ] 灵感页三栏、搜索、捕捉、设置页的人工/端到端走查（下一阶段随 e2e 一起补）。

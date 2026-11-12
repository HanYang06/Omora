# 渲染层：DOM renderer

> 状态：**已定未实现**。React 移除与 DOM 直写的决策见 [ADR-0002](decisions/0002-no-react-dom-renderer.md)。
> 本文定义 kind 接口、renderer 协调规则、测试约定；实现落在 `app/ui-engine/src/dom/`。

## 0. 一句话

`node → DOM`，`id → element`，更新只改该改的地方；没有第二棵虚拟树。

## 1. 分层

```text
app/main           挂载 + 连接 + 快照
dom/app            会话/快照 → renderer
dom/renderer       node ↔ element 协调、挂载/更新/卸载
dom/kinds/*        kind → DOM（38 个）
dom/registry       type → Kind 注册表
dom/types          Kind / RenderContext
dom/testing        测试用的 mount helper
```

`dom/` 不依赖 React；`core/` 与 `render/` 中的协议、连接、patch、compose 保持框架无关。

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

- 有 `node.id` 用 id；没有时用 **父路径 + 位置** 作为临时键（v1 兼容）。
- 同一个键、同一个 type：复用元素，调 `update`；
- 同一个键、type 变了：`destroy` 旧元素，`create` 新元素；
- 旧键消失：`destroy` + 移除；
- 新键出现：`create` + 插入到正确位置。

更新按 **引用** 短路：`node` 引用没变就整棵跳过（v1 patch 保留了未变子树的引用）。

### children

renderer 递归协调 children，按子节点下标挂到 `childrenHosts(el, node)[i]`；没声明就全挂到 `el`。

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
- 正在进行中的录制/上传：卸载时按现有 v1 行为“停止并提交”，由 capture kind 自己实现。

## 6. 测试

- 用 `jsdom`（已有 devDependency）；测试文件头写 `// @vitest-environment jsdom`。
- 统一 helper：`dom/testing.ts` 提供 `mount(nodes)` → `{ root, renderer, events }`，断言 DOM 结构与事件 id。
- 每个 kind 至少：渲染出的标签/class、关键属性、事件 id、销毁清理。
- 不再用 React `renderToString`；测试从“组件渲染”改成“DOM 行为”。

## 7. kind 分组与写域

| 文件              | kind                                                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `kinds/layout.ts` | column / row / list / item / split / rail / panel / slot / empty / card                                                  |
| `kinds/basic.ts`  | text / icon / tile / chip / hotkey                                                                                       |
| `kinds/form.ts`   | button / input / switch / checkbox / radio / select / textarea / number_input / slider / field / button_group / progress |
| `kinds/nav.ts`    | tabs / accordion / search / suggestion / result                                                                          |
| `kinds/media.ts`  | recorder / audio / audio_capture / video_capture / video / waveform                                                      |

`registry.ts` 负责汇总这五个 map；各组只改自己的文件，避免冲突。

## 8. 迁移映射

React 文件只作为“当前行为与 markup 的参考”，不修改：

- `render/components.tsx` + `controls/*` + `cards/tiles/icons/waveform` → 对应 kind；
- `capture/*` hooks → media kind 内部的控制器；
- `search/search.tsx` → nav kind；
- `shell/shell.tsx` → `dom/shell.ts`（Lead 负责）；
- `app.tsx/main.tsx` → `dom/app.ts` + `main.ts`（Lead 负责）。

## 9. 验收

- 38 个 kind 全部有 DOM 实现与测试；
- 灵感页三栏、搜索、捕捉、设置页在 DOM renderer 下行为一致；
- 删除 React 依赖与 React 文件；`tsc` / eslint / prettier / vitest 全绿。

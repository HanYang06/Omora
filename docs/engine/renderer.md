# 渲染层：Kind、DOM 协调与 V1 适配

> 状态：**现状**（2026-11-20）。生产路径 = V1 运行时 → `app/tree/tree_renderer` →
> `Kind` 组件；`renderer/renderer.ts` 的通用 DOM 协调器保留给组件单测，不再承载 Slot 主路径。
> 决策见 [ADR-0002](decisions/0002-no-react-dom-renderer.md)。
> 相关：[tree-runtime.md](tree-runtime.md) · [components.md](components.md) · [layering.md](layering.md)

## 0. 一句话

`node → element`，稳定 id → 元素复用；更新只改该改的地方，没有第二棵虚拟树。

## 1. 分层

```text
app/tree/tree_host.ts       V1 运行时宿主：直接操作 DOM 子节点
app/tree/tree_renderer.ts   V1 节点 → Kind 输入；mount / update / unmount
components/*                Kind：38 个组件 + app / page-link / dialog / virtual-list
components/tree_kinds.ts    V1 kind 词表（裸名字 + app + page-link）
renderer/types.ts           Kind / RenderContext / 渲染节点类型
renderer/events.ts          事件名 → handler id（统一入口）
renderer/renderer.ts        通用 DOM 协调器（组件单测用；不是生产主路径）
components/testing.ts       组件单测 helper（无 jsdom 全局的替换）
```

## 2. Kind 接口

```ts
export interface RenderContext {
  event(handler: string, payload?: JsonObject): void;
  loadMedia(media: string): Promise<MediaData>;
  cleanup: (dispose: () => void) => void;
}

export interface Kind {
  create(node: Node, ctx: RenderContext): HTMLElement;
  update?(el: HTMLElement, node: Node, ctx: RenderContext): void;
  destroy?(el: HTMLElement): void;
  childrenHosts?(el: HTMLElement, node: Node): (HTMLElement | null)[] | null;
}
```

- 元素保留 `data-type` / `omora-*` class；事件统一走 `ctx.event(handler, payload)`。
- 局部状态（输入草稿、tabs、录制状态）留在元素或闭包里；需要清理的登记到 `ctx.cleanup`。
- 不认识 kind 在 V1 是硬失败（构建期 `E-TREE-KIND`；运行时挂载失败），不画占位。

## 3. V1 适配（生产路径）

`tree_renderer.ts` 把 V1 节点搬到 Kind 输入：

| V1 字段              | Kind 输入                                            |
| -------------------- | ---------------------------------------------------- |
| `kind`               | `type`（裸名字，与 `treeKinds` 同键）                |
| `settings`           | `props`（组件不透明）                                |
| `on`                 | `events`（只收字符串 handler id）                    |
| `layout`             | 不搬；子节点由 `TreeRuntime` 挂                      |
| `slot`               | 内联 width / height / align-self                     |
| `collection.virtual` | `props.items` ← `data[source].items`（窗口化）       |
| `i18n`               | 从文档 `messages` 解析后写进 props                   |
| `a11y`               | role / aria-label / aria-description，覆盖组件默认值 |

运行时侧的协调规则在 [tree-runtime.md](tree-runtime.md)：按 id 建 / 更新 / 卸，
一次批量先建后放、失败回滚，兄弟元素引用不变。

## 4. 通用 DOM 协调器（组件单测）

`renderer/renderer.ts` 仍是一份与框架无关的 `node ↔ element` 协调器：key 复用、
跨父 move、`childrenHosts` 多槽、`stats`（created / updated / reused / removed）、
kind 失败换占位。它现在只被组件 jsdom 测试（cards / form / search / nav / media 等）
与 `renderer_stats` 测试使用，生产入口不再 import 它。

## 5. 测试

- 组件测试：jsdom + `tests/components/testing.ts` 的 mount helper，断言 DOM 结构、
  关键属性、事件 id、销毁清理、焦点与输入行为。
- 渲染器测试：`renderer.test.ts` / `renderer_stats.test.ts` 钉住通用协调器行为。
- V1 适配测试：`tests/app/tree/` 与 `tests/engine/tree/` 覆盖挂载、patch、回滚、复用。
- Playwright：真浏览器里的 tree 预览、虚拟列表、dialog、a11y。

## 6. 验收

- [x] 38 个 kind 有 DOM 实现与 jsdom 测试（`registry.test.ts` 钉住覆盖）；
- [x] React 已删除，入口直写 DOM；
- [x] V1 生产路径不经过 Slot 桥 / 启动骨架；
- [x] 跨父 move、元素复用、a11y / i18n / placement 在 V1 路径可测；
- [ ] 首帧 hydration（当前连接后挂载，没有预渲染 DOM 复用）；
- [ ] 三栏 / 搜索 / 捕捉 / 设置页的人工或端到端视觉走查（Playwright 只覆盖部分页）。

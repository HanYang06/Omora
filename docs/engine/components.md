# 组件：词表、authoring API 与扩展

> 状态：**已定，词表已落**（2026-11-20）。38 个 kind 有 DOM 实现与 jsdom 行为测试，
> V1 额外注册 `app` / `page-link` / `dialog` / `virtual-list`；schema 单一来源仍是【建议】，
> Python / TS 词表暂时两份手写。
> 相关：[renderer.md](renderer.md) · [tree-runtime.md](tree-runtime.md) · [build.md](build.md)

## 0. 一句话

组件 = 一个 `kind` 的 `Kind` 实现；插件用 `omora.sdk.ui` 的 Node / Page 写页面，
由 `omora.sdk.tree_build` 桥升成 `dendro.tree/1` 节点。组件词表是 Python authoring API
与 TS 实现的共同边界。

## 1. 分类（V1 裸 kind）

| 类别 | 例子                                  | 特点                            |
| ---- | ------------------------------------- | ------------------------------- |
| 结构 | `app` / `column` / `split` / `panel`  | 决定三栏与页面布局              |
| 导航 | `page-link`                           | 图标栏入口，事件回 handler      |
| 内容 | `text` / `card` / `item` / `tile` …   | 叶子或轻容器                    |
| 行为 | `hotkey` / `waveform` / `dialog`      | 副作用或平台原生                |
| 媒体 | `audio` / `video` / `audio_capture` … | 走 net 的 HTTP 媒体通道         |
| 窗口 | `virtual-list`                        | `@tanstack/virtual-core` 窗口化 |

## 2. 词表在哪

- Python authoring：`app/sdk/omora/sdk/ui.py`（Node / Page）、`controls.py`（输入控件形状）。
- TS 实现：`app/ui-engine/src/components/`；V1 注册表是 `components/tree_kinds.ts` 的
  `treeKinds`（裸名字 + `app` + `page-link`）。构建期 kind 存在性与运行时注册表共用它。
- 组件 DOM 协调器见 [renderer.md](renderer.md)。

## 3. schema 单一来源【建议】

目标：每个 kind 声明 `name` / `category` / `props` / `events` / `layout` / `collection` /
`a11y`，以 Python 词表为源导出 JSON schema，再生成 TS 类型与校验、Python 构造器、
文档表、键/slot 常量。现状仍是两份手写；新增组件要回答“schema 在哪、另一侧怎么生成”。

## 4. Authoring API ≠ wire 形态

Python 侧保留好用的构造器（`Row / Column / Split` 等），它们经 `tree_build` 编译成
规范的 `dendro.tree/1` 节点；线上只有一种节点形状。作者手感与契约形状解耦。

- V1 节点：`id` / `chain` / `kind` / `order` / `layout` / `settings` / `on` / `bind` /
  `emit`（+ 可选 `slot` / `collection` / `i18n` / `a11y`）。
- `order` 由兄弟下标 × 10 派生，保证同级唯一升序。
- 事件：`on` 映射事件名 → handler id；不执行树内规则（`reactions` 属于 v2 边界）。
- 数据：`bind` / `collection` 字段已在 schema 里；消费语义见
  [runtime-semantics](runtime-semantics.md) §1（产线尚未接 data op）。

## 5. 样式与可访问性

- 只接语义变体与 token，不接 CSS；`slot.size/align` 只管内联尺寸与对齐。
- `a11y` 字段由渲染器落到 DOM，覆盖组件默认值。
- 图标数据由节点自带，引擎只保留默认词表（`components/icons.ts`）。

## 6. 扩展路径

1. **编译期宿主组件**：随宿主构建，走同一套 Kind 注册表；改 `tree_kinds` 的 kind 表，
   不需要改引擎源码。目前尚未做成插件式。
2. **运行后来源 / TS 插件**：未开放；V1 现在只有系统插件 + 内置预览。

## 7. 未定

- schema 描述语言（Python 元数据 / 独立 JSON / TS）；
- 组件版本与兼容；
- 复合组件局部状态的暴露边界。

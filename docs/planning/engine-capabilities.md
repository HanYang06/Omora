# 引擎能力补齐（M1–M6）

> 状态：**规划**（2026-11-20）。方向见 [路线图](../roadmap.md)，队列见 [TODO](../todo.md)。
> 背景：V1 已拆桥（Slot 删除、`dendro.tree/1` 唯一格式、默认入口 tree），但“成熟 UI 引擎”还缺
> 布局、层/焦点、组件广度、i18n 完整化、主题动效、交互与工程护栏。这份文档定**怎么补、用什么轮子**。

## 0. 原则

1. **核心语义自写**：tree / ops / compose / diff / collection / 诊断，这些是我们的产品语义，不买。
2. **标准交互买**：层、焦点、菜单、tooltip、toast、表格、拖拽、快捷键、动效，优先 headless 轮子。
3. **一个轮子一层 adapter**：轮子不进 `Kind` 内部；节点 props ↔ 轮子状态、事件 ↔ `ctx.event`、cleanup 集中收口。
4. **净删才算赢**：换完量手写净行数；适配层比原实现更厚且能力没涨，就不换（Zag tabs 实测净增 84 行，已回退）。
5. **不把业务语义塞进引擎**：**可篡改权 / 引擎级权限、审计不做**。页面级差异用“按权限发不同结构的 tree”，归插件 / 宿主。
6. **concept 先于依赖**：没有页面需要前不扩组件词表；先有疼的问题再加能力。

## 1. 能力矩阵

| 能力                   | 现状                                        | 做法                                               | 轮子                                                                    | 规模 | 里程碑 |
| ---------------------- | ------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------- | ---- | ------ |
| 脏节点产线             | 事件后整页重建再差分（ADR-0005 后置）       | 结构型变更再评估；列表走 collection                | 无（自写）                                                              | L    | M1     |
| data / collection 产线 | 已落：Python 发 data + 能写 collection      | `changes` 增量；插入 / 删除的整列重排              | 无（自写）                                                              | L    | M1     |
| 类型检查后半           | 只查 kind 存在性                            | per-kind settings schema、on/bind 引用、warning 码 | JSON Schema 已有                                                        | M    | M1     |
| 复杂度护栏             | 已进 CI：棘轮 + ideas 常数断言              | 换页面时照抄同一套断言                             | 自写斜率测试                                                            | M    | M1     |
| 布局                   | 只有 `slot.size/align`                      | 声明式 flow/grid/stack/scroll/gap → CSS            | CSS 本身；gridstack/muuri 仅按需                                        | S/M  | M2     |
| 层 / 焦点              | 原生 `<dialog>`                             | popover/menu/tooltip + focus scope + 定位          | `@floating-ui/dom`、`focus-trap`、Zag dialog/menu/popover               | M    | M3     |
| 组件广度               | 38 kind；tabs/accordion/combobox 手写或缺失 | 统一 adapter，逐个换；先量净行数                   | Zag：tabs / accordion / select / combobox / tooltip / toast / tree-view | L    | M4     |
| 表格                   | 无                                          | headless 表格                                      | `@tanstack/table-core`                                                  | M    | M4     |
| i18n 完整化            | prop→key 静态渲染                           | 参数/复数/select、locale 切换、catalog             | `@formatjs/intl`、`@formatjs/cli`、已有 `intl-messageformat`            | M    | M5     |
| 主题                   | 浅色                                        | CSS 变量 + token；暗色 `[data-theme]`              | `open-props`                                                            | S    | M5     |
| 动效                   | 无                                          | 列表进出 + 层过渡                                  | `@formkit/auto-animate` + CSS                                           | S    | M5     |
| 拖拽排序               | 无                                          | 列表排序 / 置顶 / 跨容器                           | `sortablejs`                                                            | M    | M6     |
| 快捷键                 | 插件级 hotkey                               | 引擎 command 注册 + 快捷键                         | `tinykeys`；命令面板复用 Zag combobox                                   | M    | M6     |
| 工程护栏               | 部分                                        | DevTools/树检查器、schema 单一来源、斜率测试       | 无（自写）                                                              | M    | M6     |
| 0.2 发布               | 未发                                        | schema 冻结、迁移 runner、安装包、release notes    | `electron-updater`（发布后接）                                          | M    | 0.2    |

## 2. 各里程碑

### M1 生产地基（最先）

- 复杂度护栏：计数棘轮 + ideas 页常数断言进 CI。
- `data` op 产线 + collection 编写端 / bind；ideas rail / feed 用上；`changes` 增量后补。
- 类型检查后半。
- 脏节点产线后置（ADR-0005）：列表 O(k) 靠 keyed collection，不靠脏子树。
- **退出**：ideas 一页捕获/搜索/详情走 O(k)；data op 有跨语言 fixture；斜率测试挡全树重算；全量门禁绿。

### M2 布局

- 补声明式 vocabulary：flow（row/column/wrap）、gap、align/justify、grid（columns/rows/span）、scroll、stack。
- 映射到 CSS Grid/Flex/overflow，**不自研布局算法**。
- 只有仪表盘/瀑布流等真实需求出现，才评估 `gridstack.js`（dashboard）或 `muuri`（masonry）；不引 `yoga-layout`（WASM flex + 绝对定位，丢无障碍）。
- **退出**：四页里至少两页用 vocabulary 排，不再写 kind 私有布局。

### M3 层 / 焦点

- 定位：`@floating-ui/dom` + autoUpdate；平台优先 `<dialog>` / `popover` / `inert`。
- 焦点：`focus-trap` / `tabbable`；模态与 popover 的 focus scope 统一。
- 组件：Zag dialog/menu/popover 状态机，DOM 仍由 `Kind` 建。
- **退出**：菜单/tooltip/popover 不手写键盘与定位；axe critical 为 0。

### M4 组件广度

- 一个 `zag_adapter`：machine context ↔ node props，事件 ↔ `ctx.event`，cleanup ↔ stop。
- 先换手写最多的：combobox（search）、tabs、accordion；再 select/tooltip/toast/tree-view。
- 表格用 `@tanstack/table-core`；虚拟化已有 `@tanstack/virtual-core`。
- **退出**：每个替换有净行数记录；净增不合并。

### M5 i18n / 主题 / 动效

- i18n：message 参数、复数/select、locale 切换、catalog 抽取；schema additive。
- 主题：token + 暗色；不自研设计系统。
- 动效：`auto-animate` 列表 + CSS 层过渡。
- **退出**：至少一个页面可切 locale；暗色可用；列表增删有过渡且可关。

### M6 交互 / 工程

- `sortablejs`：灵感置顶/排序/跨容器。
- `tinykeys` + command registry：快捷键与命令面板。
- DevTools/树检查器、schema 单一来源、斜率测试进 CI。
- **退出**：排序与快捷键有行为测试；schema 由单一源生成。

## 3. 轮子账本

| 轮子                      | 用途                                                        | 备注                                  |
| ------------------------- | ----------------------------------------------------------- | ------------------------------------- |
| `@floating-ui/dom`        | 层定位                                                      | MIT；成熟；autoUpdate                 |
| `focus-trap` / `tabbable` | 焦点圈                                                      | MIT                                   |
| `@zag-js/*`               | tabs/accordion/select/combobox/menu/tooltip/toast/tree-view | MIT；headless、框架无关；逐个量净行数 |
| `@tanstack/table-core`    | 表格                                                        | MIT；与 virtual 同族                  |
| `@formkit/auto-animate`   | 列表动效                                                    | MIT；小                               |
| `sortablejs`              | 拖拽排序                                                    | MIT；成熟                             |
| `tinykeys`                | 快捷键                                                      | MIT；小                               |
| `open-props`              | 主题 token                                                  | MIT；纯 CSS                           |
| `@formatjs/intl` / `cli`  | i18n                                                        | MIT；已有 messageformat               |
| `electron-updater`        | 更新                                                        | MIT；等发布链路再引                   |
| `gridstack` / `muuri`     | 仪表盘 / 瀑布流                                             | 仅真实需求；不预装                    |
| `yoga-layout`             | —                                                           | **不用**：WASM 布局，丢 CSS/无障碍    |

## 4. 非目标

- 可篡改权 / 引擎级权限、审计（页面差异归插件树结构）。
- 自研布局/动画/拖拽/虚拟列表引擎。
- React / JSX / hooks（保持直写 DOM）。
- 在没有页面需要前扩组件词表。

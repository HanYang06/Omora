# V1 树：静态结构与最小节点更新

> 状态：**目标架构**（[ADR-0004](../engine/decisions/0004-static-tree-minimal-updates.md)）；分阶段接管默认入口。
> 这份文档回答四件事：旧结构坏在哪、V1 怎么修、现在做到哪、还差什么。
> 运行时语义（数据 / 行为 / 权限 / 协议 / 持久化 / 失败）见 [运行时语义](../engine/runtime-semantics.md)。

## 0. 旧结构的两个同源缺陷

### 0.1 每事件全树重建

一次 UI 变更现在的链路：

**事件 → 整份 view 重新序列化（Python）→ 整帧传输 → 全树链接（TS）→ 全树替换 → 按 id diff → 落 DOM**

每一层都是 O(N)，N 是整页的节点数。改一个按钮的文字，也要走完整棵树。

项目自己的文档写过这件事：`docs/design/packages.md` §7.3——“当前主会话每个事件交整份 view（重链 + 全量替换），渲染层按 id 复用 DOM；增量 ops / data 是后续优化”。

DOM 复用省的是“创建元素”，不是“序列化、传输、链接、替换、diff”的遍历。所以这不是“渲染优化能补上”的问题。

### 0.2 运行时组织树

启动与切页也要整棵链接：静态构建只覆盖“空数据首帧骨架”（`scripts/static_ui.py`），真实视图仍然是运行时由插件交局部树、TS 链接出来。

两个缺陷同源：**结构在运行时才成立**。树小看不出来，树大必然出现；这不是“要不要测”，是构造决定的。

## 1. V1 的答案

| 旧问题           | V1 的做法                                                      |
| ---------------- | -------------------------------------------------------------- |
| 整棵树重画       | 每个节点可单独寻址（`id` / `chain` / `order`），最小变更是节点 |
| 变更代价随全树   | 替换大节点慢、替换小节点快；代价取决于节点，不取决于树         |
| 运行时组织树     | 结构在构建期 compose（`dendro.tree/1`），运行时只 mount        |
| 全树 diff        | Page 持可变 Node，脏节点天然可知，不需要新旧文档对比           |
| 全量帧           | 上层协议只发变更节点 + 有限数据                                |
| 运行期才发现冲突 | 父子、顺序、重复身份在构建期 compose 时报错，不等到运行时      |

一句话：**结构静态、节点可寻址、更新最小、协议只带增量。**

## 2. 现在做到哪

| 能力                              | 状态                         | 证据                                                                               |
| --------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------- |
| 节点契约 + schema + 跨语言校验    | 已落                         | `schema/tree/`、`contract/tree.ts`、`sdk/tree.py`                                  |
| 构建期 compose + 诊断             | 已落                         | `link/tree_compose.ts`（E-COLLISION / E-PARENT-MISSING / E-TREE-CHAIN）           |
| 真实页面构建期 compose            | 已落（四页）                 | `scripts/static_tree.py` → `dist/tree/pages/*.json`                                |
| 构建门禁（compose / 语义 / kind） | 已落                         | `build/vite-tree.ts`、`scripts/tree_artifacts.py`、`E-TREE-KIND`                   |
| collection 声明字段               | 已落（运行期未接）           | schema `collection`、`sdk/tree.py`、`compose.ts`                                   |
| runtime mount / replace / dispose | 已落；DOM 宿主与组件适配已落 | `engine/tree/runtime.ts`、`app/tree/tree_host.ts`、`app/tree/tree_renderer.ts`     |
| Page / State / When / Bind        | 已落（SDK 层）               | `sdk/page.ts`、`authoring/page.py`                                                 |
| Node scope / 生命周期             | 已落                         | `sdk/scope.ts`、`authoring/scope.py`                                               |
| 类型检查第一遍                    | 只落 kind 存在性             | `tree_kinds.ts`；settings schema / 引用未做                                        |
| 运行时最小应用                    | 已落                         | `runtime_update.ts`、`runtime_ops.test.ts`（setProps / mount / unmount / replace） |
| ops 形状 + 跨语言 fixture         | 已落                         | `sdk/tree_ops.py`、`engine/tree/ops.ts`、`tree-ops.json`                           |
| ops 文档层应用                    | 已落                         | `engine/tree/apply.ts`（版本 / 原子 / 路径复制 / `changed`）                       |
| ops 协议帧                        | **未落**                     | 主会话仍发整份 view                                                                |
| 产物消费（预览 / 默认入口）       | 预览已落；默认入口未落       | `app/tree/preview.ts`、`?engine=tree`                                              |
| 页面插件迁移                      | **未落**                     | 页面仍由 Slot 产出                                                                 |

结构层已经成立；**更新层和协议层还没接上**。这就是下一步的全部内容。

## 3. 目标链路

```text
Python: Page 改 Node → 脏节点 ops（replace / setProps / mount / unmount / data）
   ↓ 协议帧：{ base: version, seq, ops: [...] }
TS: 按 id 原子应用 → 不重链 → DOM 只 patch 变更子树
   ↓ 版本不匹配 / 应用失败
   全量 view 兜底（不是主路径）
```

三条硬要求：

1. **原子**：一批 ops 要么全应用，要么全回滚，不留半棵树。
2. **版本**：`base` 对不上就拒绝，走全量兜底；不猜顺序。
3. **可测**：跨语言 fixture 钉住 ops 形状；斜率测试钉住 O(k)。

## 4. 迁移顺序

1. 冻结 ops 形状 + 跨语言 fixture（单线，先做）。
2. Python 发射端：Page / 插件只交变更节点。
3. TS 应用端：按 id 原子 apply，不重链。
4. 真实页面构建期 compose：先 ideas，再其余。
5. 页面插件迁移：ideas / projects / requirements / manager。
6. 删除旧 Slot 默认路径；全量只作兜底。

## 5. 核心与非核心

**核心（必须做完，否则引擎不成立）**：

- 静态结构：真实页面构建期 compose。
- 最小节点更新：ops + 脏节点。
- 协议：ops 帧、版本、兜底、跨语言 fixture。
- 主路径：页面插件迁移 + 旧 Slot 删除。
- 护栏：事件 → DOM 不随总节点数增长。

**非核心（随业务与维护补）**：

- 组件词表补齐（按页面需要）。
- 规则执行 `reactions`、`observe/intercept`、`before/after`。
- 远程 / worker 来源、订阅、媒体登记。
- 集合嵌套、窗口化、坏条目隔离。
- 权限细项、审计扩展。

## 6. 为什么分阶段，不是一刀切

- 两套契约（`dendro.ui/1` / `dendro.tree/1`）没有转换器，只能逐页迁。
- 协议没定之前不能切主路径，否则丢更新。
- 旧路径是兜底，删早了没有退路。

分阶段不是犹豫，是**给每一步留回滚**。

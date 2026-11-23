# V1 树：静态结构与最小节点更新

> 状态：**唯一格式与默认入口**（2026-11-20）。旧 Slot（`dendro.ui/1`）已删除，
> 作为历史留在 [ADR-0004](../engine/decisions/0004-static-tree-minimal-updates.md)、
> [archive](../engine/archive/) 与 [changelog](../changelog.md)。
> 运行时语义见 [runtime-semantics](../engine/runtime-semantics.md)，
> ops 见 [tree-ops](../engine/tree-ops.md)，运行时见 [tree-runtime](../engine/tree-runtime.md)。

## 0. 它解决的两个同源缺陷

### 0.1 每事件全树重建

旧链路：**事件 → 整份 view 重新序列化 → 整帧传输 → 全树链接 → 全树替换 → 按 id diff → DOM**。
每一层都是 O(N)，N 是整页节点数。

### 0.2 运行时组织树

旧结构是多个局部树 + 集合模板，启动与切页都要在运行时链接成权威根树；
静态构建只覆盖空态骨架。

两个缺陷同源：**结构在运行时才成立**。V1 的答案：结构在构建期 compose，
节点按稳定 id / chain / order 可寻址，更新只带差异。

## 1. 现在的链路（已实现）

```text
插件（omora.sdk.ui 的 Page / Node）
  → sdk/tree_build：升成 dendro.tree/1 的 base + 局部树
  → ui.tree（首帧 / 重连 / 切页）
  → TS link/tree_compose：compose 成唯一文档 → 挂载
  → 事件：ui.tree_event → Python 重建 + 差分
      ├─ 能表达：setProps / mount / unmount（ops，按 id patch）
      └─ 表达不了：整树回退（kind:"tree"，整棵替换）
  → 异步变化：set_page / refresh_page 推 ui.changed（ops 或整树）
```

- 构建期：`scripts/static_tree.py` → `dist/tree/`，`?engine=tree` 预览消费。
- 默认入口：tree-live（连 Python）；`?engine=tree` / `virtual` / `dialog` 是内置预览。
- `ui.tree_event` 当前只产 `setProps` / `mount` / `unmount`；`replace` / `data`
  形状与应用端已实现，产线暂未发。
- `ui.changed` 推 ops / 整树，客户端与事件共用一条串行队列。

## 2. 现在做到哪

| 能力                              | 状态             | 证据                                                                                                       |
| --------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------- |
| 节点契约 + schema + 跨语言校验    | 已落             | `schema/tree/`、`contract/tree.ts`、`sdk/tree.py`                                                          |
| 构建期 compose + 诊断             | 已落             | `link/tree_compose.ts`（E-COLLISION / E-PARENT-MISSING / E-TREE-CHAIN）                                    |
| 真实页面构建期 compose            | 已落（四页）     | `scripts/static_tree.py` → `dist/tree/pages/*.json`                                                        |
| 构建门禁（compose / 语义 / kind） | 已落             | `build/vite-tree.ts`、`scripts/tree_artifacts.py`、`E-TREE-KIND`                                           |
| runtime mount / replace / dispose | 已落             | `engine/tree/runtime.ts`、`app/tree/tree_host.ts`                                                          |
| ops 形状 + 跨语言 fixture         | 已落             | `sdk/tree_ops.py`、`engine/tree/ops.ts`、`tree-ops.json`                                                   |
| ops 文档层 + 运行时最小更新       | 已落             | `engine/tree/apply.ts`、`runtime_update.ts`、`runtime_ops.test.ts`                                         |
| `data` op 文档层                  | 已落             | `engine/tree/apply.ts`（revision 幂等 / 过期诊断）                                                         |
| 默认入口 + 事件 + 异步推送        | 已落             | `ui.tree` / `ui.tree_event` / `ui.changed`；`app/tree/live.ts`                                             |
| page / scope / when / bind 契约   | 已落（SDK 层）   | `sdk/page.ts`、`authoring/page.py`                                                                         |
| collection 运行期原语             | 已落（TS）       | `engine/tree/collection.ts`、`runtime_collections.ts`                                                      |
| Python 脏节点产线                 | **未落（后置）** | 事件后仍重建整页再差分；按 [ADR-0005](../engine/decisions/0005-data-collection-before-dirty-nodes.md) 后置 |
| data / collection 产线            | **已落**         | Python 发 `data` op；SDK 能写 collection（templates + bind）；ideas 的 rail / feed 用上；`changes` 未接    |
| 类型检查后半                      | 只落 kind 存在性 | per-kind `settings` schema / `on` / `bind` 引用未做                                                        |
| 权限 / 审计 / 规则                | **未落**         | V1 引擎不判定权限；`reactions` 留 v2                                                                       |
| 复杂度护栏                        | **已落**         | 计数棘轮进 CI + ideas 页常数断言（50 / 500 条，页面树一样大）                                              |

## 3. 三条硬要求

1. **原子**：一批 ops 要么全应用，要么全回滚，不留半棵树。
2. **版本**：`base` / `document` / `seq` 一致；差分表达不了就整树兜底，不猜。
3. **可测**：跨语言 fixture 钉住形状；复杂度斜率钉住“事件 → DOM 不随总节点数增长”。

## 4. 迁移顺序（已完成的部分）

1. ~~冻结 ops 形状 + 跨语言 fixture~~（已落）。
2. ~~Python 发射端：由整页文档差分出 ops~~（已落；按 ADR-0005，下一步是 data / collection 与护栏）。
3. ~~TS 应用端：按 id 原子 apply，不重链~~（已落）。
4. ~~真实页面构建期 compose~~（四页已落）。
5. ~~页面插件接 V1~~（页面仍经 `tree_build` 桥，但默认入口已只走 V1）。
6. ~~删除旧 Slot 默认路径~~（TS / Python 两条拆桥分支已删）。

## 5. 核心与非核心

**核心（引擎收口）**：

- data / collection 产线：Python 发 `data` op；collection 编写端（templates + bind）已落，ideas 的 rail / feed 用上；
  `changes` 增量待接。
- 护栏：事件 → DOM 的工作量不随总节点数增长，进 CI（棘轮 + ideas 页常数断言）。
- Python 脏节点产线：按 [ADR-0005](../engine/decisions/0005-data-collection-before-dirty-nodes.md) 后置——
  列表 O(k) 靠 keyed collection，不靠脏子树。
- 权限 / 审计接 V1（宿主策略 + guard 注入点）。

**非核心（随业务与维护补）**：

- 组件词表补齐（按页面需要）。
- 树内规则 `reactions`、观察 / 拦截钩子。
- 远程 / 运行后来源、订阅、媒体登记。
- 集合嵌套、窗口化、坏条目隔离的产线部分。
- schema 单一来源与代码生成。

## 6. 为什么先结构、后更新

结构先立住，更新才有基准：先冻结文档与 ops 形状、构建期 compose、运行时挂载；
再补最小更新与协议。倒过来做（先做增量更新）没有稳定的文档形状可依。
拆桥已经完成，现在是“把 O(N) 的产线换成 O(k) 的产线”。

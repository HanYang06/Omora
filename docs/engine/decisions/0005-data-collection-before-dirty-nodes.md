# ADR-0005：先做 data / collection 与护栏，脏节点产线后置

- **状态**：已接受（2026-11-22）
- **决策者**：项目作者 + Lead
- **相关**：[ADR-0004](0004-static-tree-minimal-updates.md)（目标架构）、[路线图](../../roadmap.md)、
  [V1 树](../../planning/v1-tree.md)、[ops](../../engine/tree-ops.md)、[collection](../../engine/collection.md)

## 背景

现期目标是"事件路径 O(k)"，原队列把 **Python 脏节点产线（#159）** 排第一。
2026-11-22 在真实代码上量了一次（本地，单次 `build_page` + `compose` + `needs_full` + `diff_documents`；
不是 CI 计时，只作方向判断）：

| 页面节点数 | 改一条标题              | 置顶一条（末条挪到最前）      |
| ---------- | ----------------------- | ----------------------------- |
| 105        | 1.38 ms，1 个 setProps  | 1.39 ms，**100 个 setProps**  |
| 205        | 2.62 ms，1 个 setProps  | 2.82 ms，**200 个 setProps**  |
| 405        | 4.97 ms，1 个 setProps  | 5.66 ms，**400 个 setProps**  |
| 805        | 10.35 ms，1 个 setProps | 11.90 ms，**800 个 setProps** |

两条事实：

1. **计算是 O(N)**：节点数翻倍，耗时翻倍；协议只发 1 个 op，算却算整页。
2. **置顶不是整树回退，是更糟的情况**：`needs_full` 返回 False，于是按位置 id 逐条 `setProps`——
   N 个节点发 N 个 op、DOM 整列重画。而 ideas 每事件其实构建两遍
   （`refresh()` 交一次，`tree_event` 再 `rebuild` 一次）。

根因在树的身份与顺序：

- id 按兄弟下标派生（`tree_build._ui_node` 用 `f"{key}/{index}"`），插入 / 重排会让后面所有 item 的 id 漂；
- `keyed()`（`sdk/node_key.py`，本次一并删除）被 ideas 用来标列表项，但 **tree_build 不读 `id_key`**：
  实测 `[A,B]` 与 `[B,A]` 得到的 id 完全对调，那个"稳定 key"目前是装饰；
- ops 没有 `move`，`order` 是结构字段 → 同级顺序变化只能整树回退，或者像上面那样按位置错分配。

即使脏节点产线落地，也只解决"改一条文本的计算不再 O(N)"；**置顶 / 插入 / 删除仍是 O(N) 甚至 O(N) 个 op**。
ideas 的 N 恰恰在两张列表（rail + feed）。列表的正解是 keyed collection：身份与顺序是数据，不是结构。

## 决定

1. **现期顺序改为**：复杂度护栏（#162）→ data / collection 产线（#160）→ 类型检查后半（#161）→
   脏节点产线（#159，记为已知债）。理由：列表 O(k) 的瓶颈在身份与顺序，不在"只算脏子树"。
2. **不引入 ops `move`，不改 `order` 语义。** 列表用 collection 承载；树仍只表达静态结构。
3. **暂不接 `id_key`。** 它只稳 id、不稳 order，单独落地没有可观测收益；
   等 collection 落地后如果仍有结构型列表，再评估。
4. **集合条目的 per-item 事件身份走运行时注入**：实例 id 形如 `<slotId>#<key>`，
   事件 payload 带 `item = key`，不覆盖调用方已有的 `item`；payload 本来不透明，线协议形状不变。
5. **`changes` 增量暂不接**：data op 先发 `items` 全量，DOM 侧按 key reconcile；
   字节与序列化仍是 O(N)，记为已知债，等真实数据量说话。
6. **护栏不测绝对值，测计数**：build / compose / walk 三阶段节点数。
   节点型页面按"线性上界"棘轮；数据型页面（ideas）用常数断言验收：50 条与 500 条灵感，
   页面树一样大、重交一次树的处理量一样多。

## 后果

**得到**：

- 现期退出条件（ideas 一页 O(k)）有了一条能走通的路，不是"先做完一个救不了列表的产线"。
- 护栏先立：后面每换一段产线，都能用同一把尺子验收。
- 协议不新增 op、不改 order 语义，回滚面小。

**要自己负责**：

- `changes` 未接期间 data op 的字节是 O(N)；要如实写进 PR 与文档，不假装已经 O(k)。
- collection 的模板事件身份是一个新约定（`item` 字段），插件要按它取条目 key。
- 常数断言只覆盖 ideas；新页面接 collection 时要照抄同一套断言，否则它只是"这一页的测试"。

**风险与缓解**：

- 风险：data / collection 落地了但 ideas 仍走整页重建。缓解：#160 的验收写死"ideas feed 用上 collection"。
- 风险：把 `items` 全量当终点。缓解：PR 里写清 `changes` 是下一步，并在 #160 的 `next` 里保留。

## 被否掉的方案

- **先做 #159 脏节点**：对 ideas 的列表无效——置顶仍整树回退或 O(N) 个 op，退出条件达不到。
- **给 ops 加 `move`**：协议多一种边界，身份仍按位置；collection 已经是设计好的容器，不需要第二套。
- **直接接线 `id_key` 当解**：只稳 id 不稳 order，插入 / 重排照样整树；属于半接。
- **把 feed 换成 collection 但不管 per-item 事件**：点了分不清哪一条，等于半接。

## 到期日

2026-12-04（现期末）前：#162 进 CI、#160 至少一页（ideas feed）可用；
做不到就回到本 ADR 重排，并把"整页重建"继续记为已知债，不半接、不双产线。

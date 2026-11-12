# 更新：三种输入粒度

> 状态：**已定**；S3-a 已落全量（经链接器）与局部树 ops（原子应用、版本/base、changed）；S3-b 已落纯数据更新（data router：revision 幂等 + 集合全量/增量 + changed）；S3-c 已落标量绑定（in/bind → props）、会话层 route 执行与全量文档替换。渲染接入、页面协商与灵感页 spike 仍未做。
> 依赖：[addressing.md](addressing.md) · [composition.md](composition.md)
> 相关：[collection.md](collection.md) · `runtime.md`（待写） · `testing.md`（待写）

## 0. 一句话

三种更新是同一管线的三种输入粒度，不是三套协议：全量、纯数据、局部树。

## 1. 三种

| 更新       | 发什么                                    | 真实场景                                                                                      | 引擎做什么                                                      | 成本 |
| ---------- | ----------------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ---- |
| **全量**   | 全部局部树（+ 数据文档）                  | 启动/重连、来源装卸、构建/版本漂移、首次进页                                                  | 重新编译/链接、按 id 协调、重建索引                             | 最高 |
| **纯数据** | `owner + source + revision + value/items` | 录音波形与计时、上传/转写进度、连接状态、条目计数、播放进度、列表条目                         | 查 `in`/规则/集合绑定 → 改值、实例化/更新条目、跑反应           | 最低 |
| **局部树** | `target id/slot + 子树`                   | 搜索下拉出现、捕捉工作区展开、home↔results↔detail 主区、feed 增删、弹层挂 layer、贡献片段变化 | 校验归属/权限 → 替换/挂卸 → 更新索引/绑定/生命周期 → 局部重渲染 | 居中 |

## 2. 为什么缺一不可

三种各自对应一种信息位置：

- **全量**：重建者不知道现在长什么样（启动、重连、版本漂移）——所以整组重交。
- **纯数据**：生产者不知道视图在哪（媒体服务只知道进度、连接层只知道状态）——所以只标 source/revision，引擎自己找位置。
- **局部树**：视图所有者明确知道要改哪一块（工作区展开、主区换模式）——所以直接给目标 id + 子树。

少一种，就会逼着某类更新绕远路：没有数据更新，进度条每帧都要发树；没有局部树，结构性变化只能整页重来；没有全量，任何版本漂移都无法恢复。

## 3. 更新集合与事务

一次更新是**一个更新集合**：`subtree(id)` / `batch([id…])` / `node(id)`。

- 原子应用：要么全成，要么全败，不留下半棵新树；
- 只涨一个文档版本；
- 只渲染一次受影响区域；
- 批量里的顺序按声明序，不按到达顺序。

## 4. 版本与兜底

- 文档版本单调递增；每个更新带 `base` 与 `seq`。
- 客户端只在 `base` 等于自己当前版本时应用；不匹配就请求全量。
- 数据有独立 `revision`，同 revision 幂等。
- 失败升级顺序：数据表达不了结构 → 局部树；局部树落不下 → 全量；全量是最终兜底。

## 5. 载荷形状（示意）

```jsonc
{
  "document": 17,
  "ops": [
    { "op": "update", "id": "ideas.search", "props": { "value": "录音" } },
    {
      "op": "mount",
      "slot": "ideas.feed",
      "at": 0,
      "node": { "id": "ideas.feed#42", "kind": "ideas:card" },
    },
    { "op": "move", "id": "ideas.feed#42", "slot": "ideas.rail", "at": 3 },
    { "op": "unmount", "id": "ideas.feed#7" },
    { "op": "route", "page": "page.detail", "params": { "id": "42" } },
  ],
}
```

完整的帧与 payload 形状在 wire 文档（待写）；本文只定语义。

## 6. 失败与降级

- 请求不合法（目标不存在、越权、版本对不上）：拒绝并诊断，根树不变。
- 数据更新触发结构需要但树里没声明模板：要求来源改发局部树，不猜。
- 局部树目标落不下：记诊断；必要时走全量。
- 全量也编不过：保留上一棵合法根树，把诊断摆出来（fail closed）。

## 7. 不变量

1. 任意更新序列后的文档 == 用最终状态全量编译的文档（收敛）。
2. 同 revision 重复到达幂等。
3. 批量更新原子，只涨一个版本。
4. 未涉及的兄弟节点不重挂、不丢局部状态。
5. 数据更新不产生未声明的结构。

## 8. S3-a 实现（已落）

- **文档状态**（`app/ui-engine/src/runtime/document.ts`）：`DocumentState = {root, version}`；`createState` 用 v2 校验器接管根树；`DocumentIndex` 从根树重建三张索引（见 [addressing.md](addressing.md)）。
- **局部树 ops**（`src/runtime/ops.ts` + `ops_apply.ts`）：`parseOps` 校验 `{kind:"ops", document, base, seq, ops}`；`applyOps` 要求 `base == 当前版本` 且 `document == base + 1`（否则 `E-VERSION`），按序在深拷上应用，任一失败整批不生效；成功返回新状态 + `changed`（本次触碰的子树根 id）。
- **op 语义**：`update`（props 浅合并）、`mount`（at 缺省尾部，越界夹取；容量/重复 id 校验）、`move`（先删后插、成环 `E-CYCLE`）、`unmount`（根不可卸）、`replace`（原位、新 id 可换）。模板节点可 update 内容，结构操作返回 `E-PAYLOAD`（位置由 templates 命名表决定）。
- **跨语言**：Python `omora.sdk.update.serialize_ops` 产出同一形状，两侧共用 `app/sdk/tests/fixtures/ops.json`。
- **未接**：纯数据更新（data router / 集合）、`route`、渲染层（v1 仍走 `render/patch.ts`）、全量更新与运行时会话接线。

## 9. S3-b 实现（已落）

- **data router**（`app/ui-engine/src/runtime/data.ts`）：`parseData` 校验 `{kind:"data", owner, source, revision, value|items|changes}`；`applyData(document, data, payload)` 纯函数、原子（信封非法 `ok:false`，文档与 data 都不变；坏条目按集合契约 `ok:true` + 诊断）。
- **幂等**：每个 source 记住 `revision`；`payload.revision <= 当前 revision` 直接 no-op（changed/诊断为空）。文档版本不动（数据 revision 独立）。
- **集合**：按 `DocumentIndex.slotsFor(source)` 找 `collection.source === source` 的 slot；`items` 全量走 `instantiateCollection`，`changes` 走 `applyCollectionChanges`；替换 slot 保持原位/原 id，替换后重建索引；多个消费者共同更新，`changed` 是集合 slot id。
- **标量**：写 `data[source].value`，并按 `in`/`bind` 更新消费者 props（S3-c，见 [rules.md](rules.md) §4）；解析不到的值保留原 props。
- **跨语言**：Python `omora.sdk.data.serialize_data_updates` 产出同一形状，两侧共用 `app/sdk/tests/fixtures/data.json`。
- **未接**：权限/归属校验、渲染层、页面切换的按 id 协调、灵感页 spike。

## 10. S3-c 实现（已落）

- **绑定**（`src/runtime/data_bind.ts`）：标量数据按 `in` 找消费者，按 `bind` pointer 从 `data[source].value` 解析并写 props；解析不到保留原值；有变化才替换节点并进 `changed`（结构相同值不换节点）。多 input 歧义时跳过、不报错。
- **会话**（`src/runtime/session.ts`）：`SessionState {document, pages, active, data}`；`createSession` 用 v2 文档校验器接管全量文档；`applyFull` 全量替换（旧版本拒绝 E-VERSION，同/新版本接受，全换不合并）。
- **route**（`src/runtime/session.ts` + `ops.ts`）：ops 批量可含 `{op:"route", page, params?}`；`applySessionOps` 先校验目标页存在（不存在 E-TARGET-MISSING，整批不生效），再复用树 op 的原子应用，最后设置 active；版本只涨一次，route 不进 `changed`；`params` 只做形状校验，页面参数消费留给渲染/路由层。
- **跨语言**：Python `omora.sdk.update.RouteOp` 与共享 `app/sdk/tests/fixtures/route.json`。
- **未接**：渲染层（换页按 id 协调）、页面参数、灵感页 spike；`applyOps`（DocumentState 层）本身仍拒绝 route，route 必须走 session。

## 11. S3-d 实现（spike，已落）

- **渲染接入**（`src/dom/v2/`）：v2 SlotNode 经 `slotToNode` 薄桥 + `v2Registry`（`dendro:<v1 type>` 别名 / 宿主别名 / v2 原生结构 kind）交给现有 DOM renderer；不迁移 38 个 kind。
- **水合**（`src/runtime/hydrate.ts`）：全量文档的 data 投影按 source 物化成集合实例子树，session 可直接渲染。
- **换页分类**（`src/runtime/page_switch.ts`）：`diffPageTrees(previous, next)` 按 id 给出 keep / move / replace / cancel / add（live 子树；templates 不参与）。
- **集成验证**（`src/dom/v2/spike.test.ts`）：fixture → session → 水合 → 渲染；数据更新/全量替换后同 id 元素复用；换页分类 + 渲染切页。
- **未接**：跨父 move 的 DOM 复用（renderer 只在同父按 id 协调）、v2 路径进 `dom/app.ts`、layout 的 size/gap/align 进样式、路由参数。

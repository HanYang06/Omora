# 测试：不变量与验收

> 状态：**建议**；S2 已补编译诊断测试（每个已落 E- 码一条失败路径）、乱序/幂等/原子性质测试与跨语言 `local-trees` fixture 契约测试；S3-a 已补索引/ops/集合原语测试与 `ops` fixture 契约测试；S3-b 已补 data router 与 `data` fixture 契约测试；S3-c 已补标量绑定、session/route/全量替换与 `route` fixture 契约测试；S3-d 已补 Slot 渲染桥/换页分类/会话水合与 fixture→DOM 集成 spike；S3-e 已补跨父 move 复用、Slot 预览入口与生命周期账本原语测试；S4 已补权限薄层（链接期+运行期）、EngineRuntime/指标/审计、来源宿主、local-trees 全量更新与 DocumentView 集成测试；Slot 预览改走 EngineRuntime/DocumentView 后行为测试不变；SourceEngine / SourceHost.load / renderer 节点统计已有独立测试。
> 依赖：[README](README.md) · [composition.md](composition.md) · [updates.md](updates.md) · [collection.md](collection.md)
> 相关：[omora-testing skill](../../.agents/skills/omora-testing/SKILL.md)

## 0. 一句话

契约靠**性质**钉住，不靠覆盖率凑数：每条不变量都要有一个能失败的测试。

## 1. 不变量

| #   | 性质     | 怎么测                                         |
| --- | -------- | ---------------------------------------------- |
| 1   | 编译确定 | 同一组局部树，任意到达顺序，根树与诊断一致     |
| 2   | 歧义必错 | 同 slot 同位置且无显式顺序 → 编译失败          |
| 3   | 收敛     | 任意更新序列后的文档 == 终态全量编译的文档     |
| 4   | 幂等     | 同 revision 数据、同 id 局部树重复到达结果不变 |
| 5   | 原子     | 批量更新全成或全败，只涨一个版本               |
| 6   | 身份保持 | 未涉及兄弟不重挂；列表同 key 跨更新是同一实例  |
| 7   | 集合等价 | 任意增量列表 == 用最终数据全量实例化           |
| 8   | 可导出   | 任意时刻文档 + 索引可 dump 且可读              |
| 9   | 权限必检 | 越权操作拒绝且文档不变                         |

## 2. 测试层次

| 层     | 内容                                    | 例子                         |
| ------ | --------------------------------------- | ---------------------------- |
| 单元   | 纯函数：链接、索引、reconcile、规则匹配 | 顺序歧义、keyed reconcile    |
| 契约   | 同一 fixture 两侧结论一致               | Python 序列化 vs TS 解析     |
| 性质   | 随机更新序列 vs 全量重建                | 收敛 / 幂等                  |
| 集成   | 来源 + 引擎 + 渲染                      | 换页协调、数据更新、卸载清理 |
| 端到端 | 真进程 + WebSocket                      | 现有 smoke 路径              |

## 3. fixture

- 节点/文档形状：全量文档、局部树、数据更新、ops。
- 诊断：每种 `E-*` 一个最小复现。
- 集合：插入/更新/删除/移动/模板切换/坏条目。
- 换页：home → detail → back 的保留/替换/取消。
- 生成 HTML fixture 前先保证 JSON 可读可 diff。

## 4. 编译诊断测试

每个诊断码至少：**能触发、消息含现场、不产出半成品文档**。

S2 已落：`app/ui-engine/src/link/*.test.ts` 覆盖 `E-PAYLOAD` / `E-ID-DUPLICATE` / `E-SLOT-AMBIGUOUS` / `E-SLOT-CAPACITY` / `E-TARGET-MISSING` / `E-CYCLE`；`vite build` 的 `buildStart` 门禁拿共享 fixture 复现冲突（冲突时构建失败）。`static_ui.py --check` 仍只查骨架数据是否最新，还没升级成编译门禁。

S3-a 已落：`src/engine/**/*.test.ts` 覆盖三张索引（id / parent+order / source）、共享 `ops.json` 的原子应用与版本（`E-VERSION`）、每个 op 诊断失败路径、入参不变与终态收敛；`collection.test.ts` 覆盖实例化、增量与全量等价、同 key 身份稳定、坏条目隔离。

S3-b 已落：`src/engine/updates/data.test.ts` 覆盖共享 `data.json` 的标量 / 集合全量 / 集合增量、revision 幂等、多消费者、坏条目隔离、非法信封原子失败、入参不变；跨语言由 Python `test_data.py` 钉住序列化逐字段一致。

S4 续落（二）：`engine_local.test.ts` 覆盖 applyLocalTrees 重链/版本+1/水合/指标/权限拒绝/非法 payload/dispose；`kinds.test.ts` 覆盖 layout token → CSS 变量/data 属性与 update 清理；`preview.test.ts` 在预览改用 DocumentView 后原 6 条行为断言全过。

S4 续落：`host/sources.test.ts` 覆盖来源注册/更新/移除、死引用级联、歧义/容量 fail closed、dispose；`host/audit.test.ts` 覆盖审计顺序/容量/副本；`engine.test.ts` 补注入 clock 的 apply 耗时、deny 审计、noteRender；`link/link_permission.test.ts` 与 `link/base_grant.test.ts` 覆盖链接期挂载/replace 权限、扁平 grant 归一化；`dom/slot/view.test.ts` 补渲染计数。

S4 已落：`permissions.test.ts` / `ops_permissions.test.ts` 覆盖 grant token、默认分层、五类 op 拒绝与 data 消费者拒绝、批量原子；`engine.test.ts` 覆盖 createEngine 水合、applyOps/applyData/applyFull、指标、监听、dispose 与之后拒绝；`metrics.test.ts` 覆盖计数器/诊断快照；`dom/slot/view.test.ts` 覆盖引擎↔DOM 自动重画、同 id 不重挂、权限拒绝视图不动、dispose 清容器与账本。链接期权限、observe/intercept 未实现，故无对应测试。

S3-e 已落：`src/dom/renderer_move.test.ts` 覆盖同 id+type 跨父 move、整棵子树 move、move+重排+删除+新增的 cleanup、childrenHosts 多槽、换 type 重建、重复 id、无 id 路径规则、dispose 递归清理，以及共享 Slot 文档 `applyFull` 换页后卡片元素复用；`src/dom/slot/preview.test.ts` 覆盖 `?engine=slot` 解析、示例文档渲染、切页、加卡片不重挂与入口接线；`src/host/lifecycle.test.ts` 覆盖逆序/错误隔离/幂等/fail-safe。

S3-d 已落：`src/dom/slot/*.test.ts` 覆盖桥的字段搬运/不展开模板、Slot 原生 kind（layout.flow / page-link 事件）、命名空间别名、整棵 fixture 根渲染；`src/engine/document/page_switch.test.ts` 覆盖 keep/move/replace/cancel/add 与确定性；`hydrate.test.ts` 覆盖数据投影物化/缺失/坏条目；`src/dom/slot/spike.test.ts` 覆盖 session→水合→DOM、数据更新与全量替换后同 id 元素复用、换页分类与渲染切页。跨父 move 的 DOM 复用未实现。

S3-c 已落：`src/engine/updates/data.test.ts` 补标量 `in`/`bind` 绑定（单/多 input、嵌套路径、解析不到保留、props 未变不换节点、多消费者、revision 幂等）；`session.test.ts` 覆盖共享 `document.json` 接管、`route.json` 应用、两页切页/缺页原子失败、route+树 op 混批、全量替换版本规则；跨语言由 Python `test_update.py` 的 RouteOp 与 `route.json` 钉住。渲染接入仍未实现。

## 5. 集合与身份测试

- 同 key 更新后局部状态保留（用一个计数 state 验证）。
- 顺序变化只 move，不重挂。
- 一条坏条目不连累其余。

## 6. 性能与预算

- 组合/链接耗时、补丁字节与 op 数、一次更新的重渲染节点数进基线。
- 与 legacy 实测对照：事件重画不再产生 handler 换代全量补丁。
- 预算超了先看是不是契约退化，不是直接调大预算。

## 7. 门禁

本地按 [docs/design/ci.md](../design/ci.md) 逐条跑；跨语言 fixture 必须进 CI。覆盖率是探针，不是目标；禁止用类型判断/非空判断凑覆盖率（见 omora-testing skill）。

## 8. 反模式

- 只测“函数没抛异常”；
- 用 mock 掉引擎内部，测不到组合/更新语义；
- 用快照全量对比掩盖身份丢失；
- 没有失败路径的测试。
  S5 起步补：`engine_sources.test.ts` 覆盖从 local-trees 建 SourceEngine、register/remove/整组替换、权限拒绝、dispose 与之后拒绝；`sources_load.test.ts` 覆盖 host 整组 load 与 requesterFor；`renderer_stats.test.ts` / `engine_render_stats.test.ts` 覆盖 created/updated/reused/removed 与指标累加。

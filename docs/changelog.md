# 更新日志

> 只记已经完成、可验证的变化。方向在 [路线图](roadmap.md)，未完成在 [TODO](todo.md)。

## 2026-11-22

- **产线排序（ADR-0005）**：实测列表身份按位置漂、置顶出 O(N) 个 setProps；现期改为护栏 → data / collection → 类型检查 → 脏节点，#159 后置并记为已知债。
- **复杂度护栏进 CI**：`sdk/tree_meter.py` 按 build / compose / walk 三阶段计数；节点型页面钉线性上界（`packages/ui/tests/test_complexity.py`），ideas 页钉常数（`packages/ideas/tests/test_page_complexity.py`：50 / 500 条页面树一样大）。
- **data 产线**：`PageHandle.data(source, value=… | items=…)`，revision 按 source 递增；整树 / 重连时 `base.data` 带快照，事件回调里交的数据搭本次回包（#182）。
- **collection 编写端**：SDK 新增 `Collection(source, key, templates)` 与 `bound(node, prop="item.x")`；`tree_build` 把模板子树挂在槽下、bind 写进节点（#182）。
- **集合条目身份与最小步长**：实例节点事件 payload 带 `item`（模板 handler 共享）；data op 的 reconcile 收到最小步长——内容没变的实例不碰 DOM，变化的那条只更新自己的子树（顺带修模板嵌套节点不刷新），位置没变的实例不发宿主 update（#182）。
- **ideas 改数据驱动**：rail / feed 各一个 collection（`ideas.rail` / `ideas.feed`），pin / archive / 筛选只推数据、不再重交页面；页面节点数与条目数无关（#182）。
- **重排的最小移动**：`host.reorder` 批量提交 + LIS 挑出不用动的元素——末条置顶 1 次 `insertBefore`（N=100 / 800 宿主调用数相同），头部插入 0 次移动，删除 0 次移动（#182）。
- **文档**：新增 ADR-0005；wire 补 `item` 与 key 约束；collection / tree-ops / tree-runtime / README / v1-tree / capabilities / testing 同步；修 `collection.md` 指向已删 `engine/updates/data.ts` 的漂移。

## 2026-11-20

- **拆桥：Slot 删除**：TS 侧删除 `dendro.ui/1` 文档运行时、链接期组合、EngineRuntime/DocumentView、启动骨架、Slot 组件 / 契约 / 测试；Python 侧删除 `_slot.py`、`ui.render` / `ui.event` / `ui.snapshot` 与 `omora.sdk.document` 文档运行时；默认入口只走 V1 树。
- **V1 主路径收口**：`ui.tree` 首帧 / 重连、`ui.tree_event` 回差分 ops（表达不了回整树）、`ui.changed` 推异步变化；设备上报在拉树前完成；`?engine=tree` 预览、virtual / dialog 组件预览保留。
- **ops 与数据**：`data` op 文档层（revision 幂等 / 过期诊断）、运行时 `setProps` / `mount` / `unmount` / `replace`；当前 `tree_event` 产线只发前三种，差分表达不了回整树。
- **文档切到 V1 事实来源**：README / AGENTS / ARCHITECTURE、engine 索引、wire、testing、renderer、components、build、layering、项目现状、V1 树、roadmap、TODO 全部改口径；Slot 设计文档标记为历史，ADR / archive / 本日志保留原样。

## 2026-11-18

- **架构定论**：ADR-0004 确立「静态结构 + 最小节点更新」为目标架构，V1 分阶段接管默认入口；ADR-0003 被取代。新增 [项目现状](planning/state-of-project.md)、[V1 树](planning/v1-tree.md)、[决策机制](planning/decision-process.md)；路线图改为现期 / 近期 / 长期 / 展望，TODO 按新阶段重排。
- **文档口径统一**：README / AGENTS / ARCHITECTURE / engine README / migration 对 V1 的定位统一为「目标架构、分阶段接管」；S7 剩余项归为非核心。
- **V1 树契约**：`schema/tree/tree.schema.json` 成为 `dendro.tree/1` 唯一来源；Python/TS 校验、生成类型、共享正负例、CI 漂移检查（#114）。
- **SDK node scope**：`omora.scope/1` 契约；Python/TS 的 Node/Host/Request/Capability/生命周期、move/clone/unmount/dispose；CI 类型与行为测试（#115）。
- **Page/State/When/Bind**：`omora.page/1` 契约；Python/TS Page 层、When 稳定容器、Bind 单向、Action/节点事件；旧 Slot 未接（#117）。
- **Build-time composer**：V1 document + partial `mode:new`、稳定挂载、`E-COLLISION` / `E-PARENT-MISSING` / `E-TREE-CHAIN` 原子诊断；未接 Vite（#116）。
- **Engine runtime mount**：V1 document → host/renderer registry；mount/replace/unmount/dispose、失败回滚；未接 app（#118）。
- **V1 构建产物**：`scripts/static_tree.py` 把系统插件页面升成 V1 输入；Vite 构建期 compose 成每页一份 `dendro.tree/1` 文档 + manifest，落在 `dist/tree/`（ideas 5.4 kB / plugins 10.9 kB）；`scripts/tree_artifacts.py` 用 Python 语义复验产物。运行时尚未接入。
- **V1 集合字段**：`dendro.tree/1` 节点增加 `collection`（`source` / `key` / `select` / `templates`）；模板子树参与身份校验、不可作挂载目标，组合器报 `E-COLLISION` / `E-PARENT-MISSING`。运行期实例化未接。
- **V1 kind 门禁**：`treeKinds` 成为 V1 kind 词表（legacy 词表 + `app` + `page-link`）；构建期组合后逐节点查存在性（含 `collection.templates`），未知 kind 报 `E-TREE-KIND` 并让构建失败。当前四个真实页面全部通过。
- **V1 DOM 运行时**：`TreeRuntime` 接上 DOM 宿主与 `Kind` 适配器——组件不重写，只换协调层。真实 ideas 空态在 jsdom 里挂出 app / 4 条导航 / 页面文案；`collection` 实例化与 `data` op 未接。
- **V1 ops 形状**：`setProps` / `mount` / `unmount` / `replace` / `data` 五种 op、`base`/`document` 版本与 `seq`；Python 序列化与 TS 解析共用 `tree-ops.json`。应用端（原子应用、最小重渲染）未接。
- **V1 产物消费**：`?engine=tree` 读 `/tree/manifest.json` + 页面文档挂载；dev 由 Vite middleware 现算同一批产物，`vite preview` / 部署读 `dist/tree/`。导航仍禁用（静态产物没有 handler）。
- **V1 ops 文档层应用**：`applyOps` 做版本判定、目标预检、路径复制、原子回滚与 `changed`；chain / id / order 校验；模板节点只允许 `setProps`。运行时最小重渲染与 `data` 语义未接。
- **运行时内容更新**：`TreeRuntime.applyOps` 接 `setProps`；只更新目标已挂载节点的 `node` 引用与渲染器，元素复用、兄弟不动；版本 / 原子失败沿用文档层。结构操作与 `data` 未接。
- **运行时语义统一设计**：数据权威（source + revision、实例不进文档）、行为（`on` → dispatch，V1 不做树内规则）、权限（结构只给父子；来源归属与策略在宿主 guard，引擎不判定）、协议（`document / ops / dispatch / diagnostics`）、持久化（引擎不落盘）、失败（批次原子 + 条目隔离）。
- **运行时结构更新**：`applyOps` 接 `mount / unmount`；新子树先建后放，只动目标子树、兄弟引用不变；一次批量禁止嵌套 mount 与同 id 先摘后挂。`replace` 与 `data` 未接。
- **运行时 replace**：`applyOps` 接 `replace`；旧子树摘下、新子树在同一父下按 `order` 放回，id 可换；一次批量只支持一个 replace。`data` 未接。
- **安全例外**：picomatch `GHSA-fc5q-39xc-vjpf` 为 dev-only、无 patched 版本，临时 ignore，2026-12-31 复审（#119）。
- **体量预算分档**：`fileLines` 改为可接受上限（代码 1000 / 测试 1200 / 文档 500、README 与 AGENTS 300），85% 起 `WARN`、120% 才 `FAIL`；警告不挡门禁，阻断才失败；`scripts/tests/test_budget.py` 钉住分档与合并顺序。

## 2026-11-15

- Dendrolink Slot 主会话成为默认入口；启动骨架由 Slot 链接编译；legacy 快照路径删除。
- 运行后来源示例（自动发现 + 热更新，S7.1）落地；S7.2/S7.3 仍未做。

## 2026-11-13

- Slot 文档运行时核心：三张索引、原子 ops、集合模板、data router、标量绑定、session/route。
- EngineRuntime / DocumentView / 权限薄层 / SourceHost / 审计；Slot 文档经薄桥渲染 DOM。

## 2026-11-11

- 灵感页三栏工作台、传统搜索、捕捉工作区（就地展开、录了即存、波形/命名）。
- store 通用化、插件管理器、media/audio/video 拆分、uv workspace 化。

## 2026-11-10

- Python 插件 + TS 渲染引擎的最小闭环：插件 → Slot 节点 → 界面 → 事件 → 插件。

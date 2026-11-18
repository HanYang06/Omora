# TODO

> 当前未完成的工作队列。开工前先读；完成一项就从这里删掉，并把结果写进 [changelog](changelog.md)。方向在 [路线图](roadmap.md)，不在这里。
>
> 每个条目必须有 `owner:` 和 `next:`；CI 用 `scripts/todo.py` 检查格式。已完成项不要留在这里。

## Now

- [ ] **V1 data op + collection** — owner: engine — next: data 落到 `document.data`、按 source 实例化 collection 模板、`bind` 与 keyed reconcile；坏条目 `E-TEMPLATE`。
- [ ] **产物消费：默认入口** — owner: app/engine — next: `?engine=tree` 预览已落；等 data 后接默认入口与导航 route。
- [ ] **V1 类型检查后半** — owner: engine — next: per-kind `settings` schema、`on` / `bind` 引用、`E-TEMPLATE` 与 warning 码。
- [ ] **ideas 一页端到端** — owner: ideas/ui — next: 先接 ops 帧（Python 只发变更节点），TS 按 id 原子应用，DOM 只 patch 变更子树；量复杂度斜率。
- [ ] **插件迁移清单** — owner: lead — next: 标出哪些插件产出页面（ideas / projects / requirements / manager）、哪些只提供服务，给出迁移顺序。

## Next

- [ ] **最小节点更新成为唯一主路径** — owner: engine — next: 主会话切 ops 帧，全量 view 只作版本不匹配时的兜底。
- [ ] **页面插件迁移** — owner: ideas/projects/requirements/manager — next: 四页逐个迁到 V1 路径，旧 Slot 出口逐页删。
- [ ] **删除 Slot 默认路径** — owner: lead — next: 四页迁完后删旧路径与 `dendro.ui/1` 默认入口，保留全量兜底。
- [ ] **V1 运行时治理** — owner: engine — next: 权限 / 审计 / 指标接 V1；首帧 HTML 从 V1 文档编译，替换 Slot 骨架。
- [ ] **复杂度护栏进 CI** — owner: engine — next: 加斜率测试，事件 → DOM 的工作量不得随总节点数增长。
- [ ] **Idea 闭环** — owner: ideas — next: 补标签、灵感 ↔ 灵感 / 项目的关联、转写进搜索。
- [ ] **Project 闭环** — owner: projects — next: 建项目、关联灵感 / 需求、状态推进、归档复盘。
- [ ] **0.2 发布** — owner: lead — next: 冻结 schema、补迁移 runner 与一条真实迁移、打 tag、出本地安装包与 release notes。

## Blocked

- [ ] **picomatch `GHSA-fc5q-39xc-vjpf` 复审** — owner: lead — next: 2026-12-31 前检查是否有修复版本，删除 `pnpm-workspace.yaml` 的 `auditConfig.ignoreGhsas`。
- [ ] **5 个 moderate advisory** — owner: lead — next: 评估 `qs` / `minimatch` 的升级或 override，不阻塞 high 门禁，但不能长期放着。

# TODO

> 当前未完成的工作队列。开工前先读；完成一项就从这里删掉，并把结果写进 [changelog](changelog.md)。方向在 [路线图](roadmap.md)，不在这里。
>
> 每个条目必须有 `owner:` 和 `next:`；CI 用 `scripts/todo.py` 检查格式。已完成项不要留在这里。

## Now

- [ ] **Python 脏节点产线** — owner: engine — next: 事件后别再重建整页；`tree_build` 记录脏节点、只算被改的子树并产 ops；拿 ideas 一页量复杂度斜率。
- [ ] **V1 data / collection 产线** — owner: engine — next: Python 发 `data` op；collection 实例化 / `bind` / `changes` 增量；坏条目 `E-TEMPLATE`。
- [ ] **V1 类型检查后半** — owner: engine — next: per-kind `settings` schema、`on` / `bind` 引用、warning 码；现在只查 kind 存在性。
- [ ] **复杂度护栏进 CI** — owner: engine — next: 加斜率测试，事件 → DOM 的工作量不得随总节点数增长。

## Next

- [ ] **权限 / 审计接 V1** — owner: engine — next: 引擎留 `guard(op, context)` 注入点；策略 / 审计归宿主，不把能力名塞进引擎。
- [ ] **远程 / 运行后来源** — owner: engine — next: `ui.changed` 通道已在；来源注册 / 热更新 / 媒体登记还没接，先定来源账本形状。
- [ ] **Idea 闭环** — owner: ideas — next: 补标签、灵感 ↔ 灵感 / 项目的关联、转写进搜索。
- [ ] **Project 闭环** — owner: projects — next: 建项目、关联灵感 / 需求、状态推进、归档复盘。
- [ ] **0.2 发布** — owner: lead — next: 冻结 schema、补迁移 runner 与一条真实迁移、打 tag、出本地安装包与 release notes。

## Blocked

- [ ] **picomatch `GHSA-fc5q-39xc-vjpf` 复审** — owner: lead — next: 2026-12-31 前检查是否有修复版本，删除 `pnpm-workspace.yaml` 的 `auditConfig.ignoreGhsas`。
- [ ] **5 个 moderate advisory** — owner: lead — next: 评估 `qs` / `minimatch` 的升级或 override，不阻塞 high 门禁，但不能长期放着。

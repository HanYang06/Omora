# TODO

> 当前未完成的工作队列。开工前先读；完成一项就从这里删掉，并把结果写进 [changelog](changelog.md)。路线图只写方向，不写完成记录。
>
> 每个条目必须有 `owner:` 和 `next:`；CI 用 `scripts/todo.py` 检查格式。已完成项不要留在这里。

## Now

- [ ] **Page/Node → `dendro.tree/1` serializer + component catalog** — owner: lead/sdk — next: 定义组件 kind/props/events 单一来源，Python/TS 各出 serializer，先用 ideas 的搜索/列表节点跑通。
- [ ] **V1 ideas 竖切（`?engine=v1`）** — owner: lead — next: 在 build/engine 接 serializer，旧 Slot 保持默认，不破现有入口。
- [ ] **Build Vite `buildStart` gate** — owner: build — next: 把 `assertTreeComposes` 接进 Vite 构建，冲突阻断发布，补失败 fixture。

## Next

- [ ] **Engine SourceHost / page / session / route** — owner: engine — next: compose 输出接 `TreeRuntime`，页面切换与导航可用。
- [ ] **V1 data router / collection / 三级更新** — owner: engine/sdk — next: 复用旧 Slot 的数据路由与集合模板，先跑常驻标量和列表。
- [ ] **Page clone/patch + PageHost parity** — owner: sdk — next: 定义 clone 时 When/Bind 的重绑，Python/TS 行为对齐。
- [ ] **旧 Slot 退休与页面迁移** — owner: lead — next: ideas/projects/requirements/plugins 逐页切 V1，最后让 `dendro.ui/1` 退场并改文档。

## Blocked

- [ ] **picomatch `GHSA-fc5q-39xc-vjpf` 复审** — owner: lead — next: 2026-12-31 前检查是否有修复版本，删除 `pnpm-workspace.yaml` 的 `auditConfig.ignoreGhsas`。
- [ ] **5 个 moderate advisory** — owner: lead — next: 评估 `qs` / `minimatch` 的升级或 override，不阻塞 high 门禁，但不能长期放着。

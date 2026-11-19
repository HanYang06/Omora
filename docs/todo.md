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

- [ ] **布局 vocabulary** — owner: engine — next: flow/grid/stack/scroll/gap/align 描述词映射 CSS；不自研布局算法；仪表盘/瀑布流真实需求出现再评估 gridstack/muuri。
- [ ] **层 / 焦点** — owner: engine — next: 平台 dialog/popover/inert + `@floating-ui/dom` 定位 + `focus-trap`；Zag dialog/menu/popover 状态机，DOM 仍由 kind 建。
- [ ] **组件广度（Zag adapter）** — owner: engine — next: 先做 `zag_adapter`；按 net-delete 顺序换 combobox/tabs/accordion → select/tooltip/toast/tree-view；表格用 `@tanstack/table-core`；每个替换记录净行数，净增不合并。
- [ ] **i18n 完整化** — owner: engine — next: message 参数、复数/select、locale 切换、catalog 抽取；`i18n` schema additive；至少一页可切 locale。
- [ ] **主题 / 动效** — owner: engine — next: CSS token + 暗色（`open-props`）；列表进出用 `auto-animate`，层用 CSS 过渡；不自研设计系统/动画引擎。
- [ ] **交互增强** — owner: engine — next: `sortablejs` 做灵感排序/置顶/跨容器；`tinykeys` + command registry 做快捷键与命令面板。
- [ ] **工程护栏** — owner: engine — next: 树检查器/DevTools、schema 单一来源生成；斜率测试（已列 Now）跑进 CI。
- [ ] **GitHub 工作流维护** — owner: lead — next: labels / milestones / issues 已建；Project 不启用；每周 triage 标签/里程碑，PR 用 `Closes #` 关联。
- [ ] **远程 / 运行后来源** — owner: engine — next: `ui.changed` 通道已在；来源注册 / 热更新 / 媒体登记还没接，先定来源账本形状。
- [ ] **Idea 闭环** — owner: ideas — next: 补标签、灵感 ↔ 灵感 / 项目的关联、转写进搜索。
- [ ] **Project 闭环** — owner: projects — next: 建项目、关联灵感 / 需求、状态推进、归档复盘。
- [ ] **0.2 发布** — owner: lead — next: 冻结 schema、补迁移 runner 与一条真实迁移、打 tag、出本地安装包与 release notes。

## Blocked

- [ ] **picomatch `GHSA-fc5q-39xc-vjpf` 复审** — owner: lead — next: 2026-12-31 前检查是否有修复版本，删除 `pnpm-workspace.yaml` 的 `auditConfig.ignoreGhsas`。
- [ ] **5 个 moderate advisory** — owner: lead — next: 评估 `qs` / `minimatch` 的升级或 override，不阻塞 high 门禁，但不能长期放着。

# GitHub 工作流：Issues / Milestones / Projects / Labels

> 状态：**规划 + 落地约定**（2026-11-20）。方向见 [路线图](../roadmap.md)，队列见 [TODO](../todo.md)。
> 动机：仓库已有 150+ PR、600+ commit，但 Issues / Milestones / Projects / Labels 基本没用；
> PR 记录的是“怎么改”，丢了“为什么改、改到哪算完”。从今天起把 GitHub 当工作账本，而不是只当合并按钮。

## 1. 分工

| 载体      | 回答什么                   | 粒度                     |
| --------- | -------------------------- | ------------------------ |
| Roadmap   | 方向、阶段、退出条件       | 月 / 季度                |
| Milestone | 一个阶段的范围与完成度     | M1–M6 / 0.2              |
| Issue     | 要解决的问题 + 验收 + 依赖 | 一个可验收交付物         |
| Project   | 现在谁在做什么、卡在哪     | 看板 / 表格              |
| PR        | 怎么实现、怎么验证         | 一个 issue（或一个系列） |
| TODO      | 当前 2 周的短队列          | 只放正在做/马上做的      |
| Changelog | 已完成的事实               | 发布时                   |

**Issue 不是 commit 的镜像。** 一个 issue 可以对应多个 commit / 多个 PR；不要给每个切片开 issue，也不要在没有 issue 的情况下开大 PR（紧急小修除外，事后补 issue）。

## 2. Labels

### type（与 commit 类型对齐）

`type:feature`、`type:fix`、`type:refactor`、`type:perf`、`type:docs`、`type:build`、`type:ci`、`type:test`、`type:chore`。

### 其它

| label                                                                                                     | 用途                                               |
| --------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `epic`                                                                                                    | 里程碑父 issue；子 issue 用 sub-issues / checklist |
| `area:engine` / `area:sdk` / `area:plugins` / `area:net` / `area:ui-shell` / `area:docs` / `area:tooling` | 领域                                               |
| `size:s` / `size:m` / `size:l`                                                                            | review 体量，不是工时                              |
| `needs-decision`                                                                                          | 等作者拍板（契约 / 依赖 / 文档事实来源）           |
| `blocked`                                                                                                 | 被外部条件卡住，注明条件                           |
| `good first issue` / `help wanted`                                                                        | 保留 GitHub 默认                                   |
| `accessibility` / `bug` / `documentation` / `enhancement`                                                 | 保留默认，避免再建同义 type                        |

**规则**：一个 issue 至少一个 `type:` + 一个 `area:`；PR 继承对应 issue 的 label，另加 `type:`。

## 3. Milestones

| Milestone         | 范围                                                                       | 退出条件                                           |
| ----------------- | -------------------------------------------------------------------------- | -------------------------------------------------- |
| M1 生产地基       | 脏节点、data/collection、类型检查、复杂度护栏                              | ideas 一页 O(k)，data op 有 fixture，斜率测试进 CI |
| M2 布局           | flow/grid/stack/scroll 描述词 → CSS                                        | 至少两页用 vocabulary 排                           |
| M3 层/焦点        | floating-ui、focus-trap、Zag dialog/menu/popover                           | 不手写定位/键盘；axe critical 0                    |
| M4 组件广度       | Zag adapter、tabs/accordion/combobox/select/tooltip/toast/tree-view、table | 每个替换有净行数记录                               |
| M5 i18n/主题/动效 | formatjs 参数/locale、token/暗色、auto-animate                             | 一页可切 locale，暗色可用                          |
| M6 交互/工程      | sortablejs、tinykeys、DevTools、schema 单一来源                            | 行为测试 + schema 单源                             |
| 0.2 发布          | schema 冻结、迁移、安装包、release notes                                   | tag + 安装包 + 迁移                                |

## 4. Issues

- **一个 issue 一个可验收交付物**；Epic issue 用子 issue 或 checklist 串里程碑。
- 模板：背景 / 目标 / 验收 / 依赖 / 轮子 / 非目标 / 风险。
- 优先用 `Closes #N` 关联 PR；PR 描述里贴验证命令与输出。
- 一个 issue 被拆成多个 PR 时，PR 用 `Part of #N`，最后一个 `Closes #N`。
- 不做 retro-issue：不为 150 个历史 PR 补 issue；只给当前 roadmap / 新工作建。

## 5. Projects

Project 看板字段：

| 字段      | 值                                                       |
| --------- | -------------------------------------------------------- |
| Status    | Backlog / Ready / In progress / In review / Done         |
| Area      | engine / sdk / plugins / net / ui-shell / docs / tooling |
| Milestone | M1–M6 / 0.2                                              |
| Size      | S / M / L                                                |
| Owner     | 人 / agent 名                                            |

视图：Board（按 Status）、Roadmap（按 Milestone）、Table（按 Area / Size）。
自动化：新 issue/PR 自动加入；PR 打开 → In review；PR merge → Done（用 `Closes` 关 issue）。

> `gh` 需要 `project` scope：`gh auth refresh -s project`；也可以直接在网页建。

## 6. Release notes

- 给 PR 加 `type:` label；`.github/release.yml` 按 label 分组生成 release notes。
- Release 对应一个 Milestone + tag；标题用 `0.2.0 — <主题>`。
- 不手写“100 个 PR 列表”；按 issue/milestone 汇总。

## 7. 复盘与卫生

- 每周一次 triage：新 issue 必须补齐 type/area/milestone；阻塞项标 `blocked` 并写条件。
- 看板不追求“PR 数”；看 milestone 关闭率与 issue 验收结果。
- 过期 issue：超过一个阶段没动，移回 Backlog 或关闭并写原因。
- 文档事实来源变更仍需作者确认（见 AGENTS.md “停下来问”）。

## 8. 首次落地清单

1. 建 labels（type/area/size/epic/needs-decision/blocked）。
2. 建 milestones（M1–M6、0.2）。
3. 从 TODO / [engine-capabilities](../planning/engine-capabilities.md) 建 M1–M6 的 epic issue 与首批 task issue。
4. 建 Project 看板，挂自动加入与 Status 字段。
5. 加 `.github/release.yml` 与 issue 模板。
6. 旧 PR 不回填 issue；新 PR 必须关联。

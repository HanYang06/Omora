---
name: omora-team
description: Omora 的 Agent 团队开发流程：Lead 拆任务/写域、teammate 各自 worktree/分支/PR、Lead review + merge commit、跨区整合。多区并行、开团队、分工、worktree、review/合并、快速迭代时先读。
---

# Agent 团队开发流程

> 多区任务：Lead 拆任务，teammate 各自 worktree/分支/PR，Lead review + merge commit。目标是对完成率负责，不是把任务发出去就结束。

## 1. 什么时候用

- 任务能拆成 2+ 个相对独立的区（例如 capture / manager / search）。
- 每个区能独立跑门禁、独立 PR。
- 一个人做串行太久，多人并行收益明显。

不适用：小改动、单文件、探索性 spike；直接做。

## 2. 角色

- 用户：方向、产品决策；不参与日常 review。
- Lead：拆任务、任务板、spawn、review、解决冲突、合并、整合；对完成率负责。
- teammate：在自己 worktree 里开发、测试、提交、开 PR；不合并；产品问题回 Lead；对自己的分支/worktree 负责，Lead 不改。

## 3. Lead 开工前

1. base 干净：前置 PR 已合，main 最新。
2. 任务板：每个区一个 shared task：subject / description / write scopes / blocked_by。
3. 写域尽量不重叠；重叠的（ideas / sdk / boot）在 brief 点名，约定合并顺序。
4. 每个 teammate 一份自包含 brief：
   - 仓库、base、task id
   - 任务 + 验收（可跑的门禁/测试）
   - 架构约束（读哪些 skill/docs）
   - worktree / branch
   - 流程（sync / test / gate / commit / push / PR / 报告）
   - 不 merge；产品决策回 Lead
5. `spawn_teammate`（fresh）；`reassign` task 给 teammate；第一条消息就是 brief。

## 4. teammate 的循环

1. 从 main 开 worktree：`git worktree add ../Omora-wt-<name> -b <type>/<slug> main`（或 create_worktree）。
2. sync：`uv sync`；`pnpm --dir app/ui-engine install`。
3. 实现 + 行为测试（omora-testing）。
4. `uv run python scripts/check.py` 全绿。
5. 逻辑提交（omora-git）；push；`gh pr create --base main`；PR body 五段（改了什么/为什么/怎么验证/风险与回滚/协议影响）。
6. `send_message` Lead：PR URL、门禁输出、关键决定、冲突、阻塞。
7. 卡住/需要产品决策：马上问，不猜。

## 5. Lead 的 review / 合并

1. 发现问题不自己改：在 PR 上留 review comment（这就是历史留档），再 `send_message` 让 owner 在自己的 worktree 里改、rebase、重新推；你再 review。Lead 不切别人的分支、不动别人的 worktree。
2. 看 CI / gate；看 diff，不只看文件列表。
3. 冲突：让 teammate rebase 到最新 main；不要 Lead 硬改别人分支。
4. 合并：`gh pr merge <n> --merge`（merge commit；不 squash/rebase）；删分支。
5. 合并后 base 更新；下一个 PR rebase；重复。
6. 全部合完：Lead 做跨区整合（自己的分支/PR）；再跑一次全门禁。
7. 给用户最终报告：PR 列表、门禁、遗留、下一步。

## 6. 协调规则

- 一个概念一个真相：比如 health() vs manager.phase，Lead 拍板只留一个。
- 共享文件（ideas / sdk / ui / boot）先约定归属；blocked_by 排序。
- 跨区接口（capability 通道、media HTTP）写进任务/brief；一方实现，另一方消费。
- 不要重复实现检测/状态（devices.ts 只有一份）。
- 产品决策（隐藏 vs 禁用、视频是否播放）Lead 问用户，不替用户拍。
- PR 评论是历史留档：review 结论、问题、修复要求都写在 PR 上，不只发消息。

## 7. 反模式

- teammate 在共享 checkout 里改，互相踩；必须 worktree。
- Lead 发完任务就不管；review/merge/整合才是 Lead 的活。
- 没测试/门禁就 PR；CI 红就合。
- Lead 亲自改 teammate 的分支/worktree；review 问题回给 owner，PR 评论留档。
- squash/rebase 合并；丢分支边界。
- 产品决策自己拍；用户被绕过。
- 把“发了任务”当完成；完成 = PR 合了 + 集成跑通。

## 8. 模板

### Lead 的 brief

```md
You are <name> on Omora (repo: ...; base main has ...). Read first: ...
Task id: ...
Task: ...
Requirements: ...
Workflow:
1. worktree from main: git worktree add ../Omora-wt-<name> -b <type>/<slug> main
2. uv sync; pnpm --dir app/ui-engine install; implement; behavioral tests;
   uv run python scripts/check.py
3. logical commits (omora-git); push; gh pr create --base main --head ...
4. send_message Lead: PR URL, gate output, decisions, conflicts, blockers.
   Do not merge.
```

### teammate 的报告

```md
task-<n> / <branch> / <worktree>
PR: <url>
Gate: <output>
决定/冲突/阻塞: ...
```

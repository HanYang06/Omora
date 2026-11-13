---
name: omora-team
description: Omora 的 Agent 团队开发流程与成本规则：Lead 拆任务/写域、teammate 复用与 worktree/分支、Lead 合进集成分支并只开一个 PR、review + merge commit、跨区整合。多区并行、开团队/复用 Agent、分工、worktree、PR 粒度、review/合并、成本控制时先读。
---

# Agent 团队开发流程

> 多区任务：Lead 拆任务，teammate 各自 worktree/分支，Lead 合进集成分支、review、只开**一个** PR（merge commit）。
> 目标是对完成率负责，不是把任务发出去就结束。

## 1. 什么时候用

**默认不开团队。** 先判断这件事有多大，再决定要不要拆。

三个问题，命中两条以上才开：

1. **是"修一个缺陷"还是"做一块新东西"？** 修缺陷默认自己做。一个 bug 拆给三个人，协调成本比改动本身还大。
2. **改动跨几个写域？** 内核 / SDK / 插件 / 引擎 / 文档。只有一个域，自己做。
3. **并行真的省时间吗？** 接口没定、要频繁对齐的任务，并行只会互相等；先自己把形状定下来。

规模参考（自己估，别硬套）：

| 规模 | 怎么干 |
|---|---|
| 单文件、单包、≤3 个文件 | 自己做 |
| 一个写域内的多文件 | 自己做，按事件拆提交 |
| 两个以上写域，每块能独立跑门禁 | 团队 |
| 接口未定的探索 | 自己做，先把形状写进 docs |

原来那三条（能拆成 2+ 个独立区、每区能独立跑门禁、并行收益明显）是团队**成立的条件**，
不是"该开团队"的理由 —— 条件成立但收益不够时，仍然自己做。

## 2. 角色

- 用户：方向、产品决策；不参与日常 review。
- Lead：拆任务、任务板、spawn、review、解决冲突、合并、整合；对完成率负责。
- teammate：在自己 worktree 里开发、测试、提交、推分支；**不开 PR**（PR 由 Lead 统一开）；
  不合并；产品问题回 Lead；对自己的分支/worktree 负责，Lead 不改。

## 2.1 智能体复用与成本（硬规则）

**Agent 是长期变量，不是任务耗材。** 每 spawn 一次 = 一份新上下文 + 冷缓存；上下文复用才是缓存命中。上一轮一个重构用了 31 个 teammate，钱烧得比改动还快——这是反模式，不是勤奋。

### 默认预算

- **每轮默认 1 个 teammate；最多 2 个。** 超过 2 个先问用户，不要自己扩编。
- 小任务 Lead 自己做，不开 agent：单文件、≤3 个文件、纯文档、纯改名、修一个明确缺陷。
- 并行收益不明显就串行；接口没定、需要频繁对齐的任务先 Lead 定形状，再交给一个 teammate。
- 团队成立条件（多写域、可独立跑门禁）成立但收益不够时，仍然自己做。

### 复用手册（spawn 前必须走一遍）

1. `list_agents`：找同写域、inactive 的 teammate（例：引擎/组件/渲染域长期复用同一个）。
2. 复用优先 `send_message`：brief 只写**增量**——新 task id、新分支、当前 main/PR、写域、验收；旧上下文里的仓库结构/接口/门禁命令直接复用。
3. cwd/worktree 不在了就**重建 worktree**，不要因此 spawn 新 agent；分支从最新 `origin/main` 起。
4. 任务板复用同一个 owner：`reassign` / 继续 `claim` 给原 teammate，别新建一个 owner 只做一件事。
5. 一个 teammate 可以连续接多个 task；完成一个后进入 inactive 不是退役，下一个相关任务优先唤醒它。

### 只有这些情况才 spawn 新 agent

- 写域强冲突，必须两个独立 worktree 同时写（且并行收益明确）；
- 旧 teammate 的上下文已被证明过期/污染，复用成本高于新开；
- 需要独立模型/权限/会话隔离；
- 用户明确要求新开。

### 复用注意

- 复用不等于盲信旧上下文：brief 里先给当前 main/PR 与“先读当前文件”，禁止凭记忆改代码。
- 一个 agent 连续做多件事时，每件独立提交、独立跑门禁；不要把一个 agent 的旧结论当事实。
- 上下文过长时优先压缩/重述关键约束，而不是无限续聊；确实需要新会话才 spawn，并写明理由。
- 每轮结束清理 worktree/branch 可以，但**保留 agent 身份**供下轮复用；身份比 worktree 便宜。

### 成本反模式

- 一个任务一个 agent、一个 PR 一个 agent；
- 纯文档/纯改名/单文件修复也开 teammate；
- 先 spawn 再想任务；spawn 前没查 `list_agents`；
- 为了“看起来并行”把串行任务拆成多个 agent；
- 不复用 brief，每轮重新交代整个仓库背景。

## 3. Lead 开工前

1. base 干净：前置 PR 已合，main 最新。
2. 任务板：每个区一个 shared task：subject / description / write scopes / blocked_by。
3. 写域尽量不重叠；重叠的（ideas / sdk / boot）在 brief 点名，约定合并顺序。
4. 每个 teammate 一份自包含 brief：
   - 仓库、base（**集成分支**，不是 main）、task id
   - 任务 + 验收（可跑的门禁/测试）
   - 架构约束（读哪些 skill/docs）
   - worktree / branch
   - 流程（sync / test / gate / commit / push / 报告）
   - 不开 PR、不 merge；产品决策回 Lead
5. 先建集成分支：`git worktree add ../Omora-wt-int -b feat/<slug> origin/main`，
   把冻结的契约（通常是 SDK 节点 / 载荷形状）先提交上去并 push，teammate 从它开分支。
6. 先查可复用的 inactive teammate；确需新上下文才 `spawn`。`reassign` task 给 owner；第一条消息就是 brief。

## 4. teammate 的循环

1. 从**集成分支**开 worktree：`git worktree add ../Omora-wt-<name> -b feat/<slug> origin/feat/<integration>`。
2. sync：`uv sync`；`pnpm install`（根目录 workspace，一次装齐）。
3. 实现 + 行为测试（omora-testing）。
4. 按 `docs/design/ci.md` 的命令逐条跑门禁，全绿。
5. 逻辑提交（omora-git）；push 自己的分支（**不开 PR**）。
6. `send_message` Lead：分支名、提交列表、门禁输出、关键决定、冲突、阻塞。
7. 卡住/需要产品决策：马上问，不猜。

## 5. Lead 的 review / 合并

1. 每个 teammate 的分支看完，用 merge commit 合进**集成分支**（`git merge --no-ff feat/<slug>`）。
   有问题不自己改：把问题写在任务的 review 记录里（PR 还没开时先记在任务/消息里），
   再让 owner 在自己的 worktree 里改、rebase、重新推；Lead 不切别人的分支、不动别人的 worktree。
2. 看 diff，不只看文件列表；看 teammate 报的门禁输出。
3. 冲突：让 owner 把自己的分支 rebase 到最新集成分支；不要 Lead 硬改别人分支。
4. 文档、规则、跨区整合由 Lead 在集成分支上提交（同一个功能 = 同一个 PR）。
5. 集成分支跑一次全门禁（命令见 `docs/design/ci.md`），再做端到端（能跑就跑）。
6. **只开一个 PR**：`gh pr create --base main --head feat/<integration>`；PR body 五段。
7. CI 绿 → `gh pr merge <n> --merge`（merge commit；不 squash/rebase）；删分支。
8. 给用户最终报告：PR、门禁、端到端结果、遗留、下一步。

## 5.1 PR 粒度

**一个功能 = 一个 PR。** 同一件事的文档、实现、测试都在同一个 PR 里；PR 内部按事件拆提交。

只有两种情况才拆：

- 需要**独立回滚**（比如协议变更要能单独回退）；
- 一次 review 看不完（净变更 > 800 行，或跨了三个以上互不相关的功能）。

判断标准：**如果两个 PR 的提交能并成一条「改了什么都说得清」的历史，那就该并成一个。**

## 6. 协调规则

- 一个概念一个真相：比如 health() vs manager.phase，Lead 拍板只留一个。
- 共享文件（ideas / sdk / ui / boot）先约定归属；blocked_by 排序。
- 跨区接口（capability 通道、media HTTP）写进任务/brief；一方实现，另一方消费。
- 不要重复实现检测/状态（devices.ts 只有一份）。
- 产品决策（隐藏 vs 禁用、视频是否播放）Lead 问用户，不替用户拍。
- PR 评论是历史留档：review 结论、问题、修复要求都写在 PR 上，不只发消息。

## 7. 反模式

- teammate 在共享 checkout 里改，互相踩；必须 worktree。
- 一个功能拆成三四个 PR（docs 一个、后端一个、前端一个、补文档又一个）：历史碎、review 碎、回滚也碎。
- Lead 发完任务就不管；review/merge/整合才是 Lead 的活。
- 没测试/门禁就 PR；CI 红就合。
- Lead 亲自改 teammate 的分支/worktree；review 问题回给 owner，PR 评论留档。
- squash/rebase 合并；丢分支边界。
- 产品决策自己拍；用户被绕过。
- 把“发了任务”当完成；完成 = PR 合了 + 集成跑通。
- 一个任务 spawn 一个 agent；同类任务连续开新上下文，不复用、不合并 brief。
- 一轮开 3+ 个 teammate 却不问用户；纯文档/改名也开 agent。

## 8. 模板

### Lead 的 brief

```md
You are <name> on Omora (repo: ...; base main has ...). Read first: ...
Task id: ...
Task: ...
Requirements: ...
Workflow:
1. worktree from the integration branch:
   git fetch origin; git worktree add ../Omora-wt-<name> -b feat/<slug> origin/feat/<integration>
2. uv sync; pnpm install; implement; behavioral tests;
   按 docs/design/ci.md 跑门禁
3. logical commits (omora-git); push your branch. Do NOT open a PR.
4. send_message Lead: branch name, commits, gate output, decisions, conflicts, blockers.
```

### teammate 的报告

```md
task-<n> / <branch> / <worktree>
Commits: <list>
Gate: <output>
决定/冲突/阻塞: ...
```
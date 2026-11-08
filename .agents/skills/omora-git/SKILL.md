---
name: omora-git
description: Omora 的提交、分支、推送与 PR 规范。只要你要 commit、push、开分支、开 PR、合并、改写历史，或者讨论提交信息格式、分支策略、linear history、squash / rebase，就先读这个 skill。典型触发：帮我提交、推一下、开个分支、这个提交信息行不行、怎么合并、要不要 squash。即使只是写一条 commit message，也先按这里的格式与字数要求来。
---

# 提交与推送规范

> 这个项目本身做项目管理。如果自己的历史都管不好，这套东西就没有说服力。

## 1. 提交信息：格式与字数

### 结构

```
type(scope): subject

body（可选，解释 what / why）

footer（可选：BREAKING CHANGE / Refs / Contract）
```

### 类型（必填，小写）

| type | 用于 |
|---|---|
| feat | 新能力 |
| fix | 修 bug |
| refactor | 不改行为的重构 |
| perf | 性能 |
| test | 只改测试 |
| docs | 文档 / skill |
| build | 构建、依赖、工具链 |
| ci | CI 配置 |
| chore | 杂项、仓库维护 |
| contract | 协议 / 契约变更 |
| revert | 回滚 |

### scope（可选，小写 kebab）

建议：`core` `packages` `ui-engine` `docs` `ci` `skill` `repo`

### 字数（硬限制，钩子会拦）

- 标题整行 ≤ 72 字符；
- `subject` 部分 4–50 字符；
- 正文每行 ≤ 72 字符（含 `://` 的链接行除外）；
- 页脚每行 ≤ 72 字符。

### 硬性要求

- 标题不以句号结尾；
- 标题与正文之间必须空一行；
- 不使用 `update` `fix` `wip` `temp` `changes` `stuff` 这类空话作 subject；
- 一条提交只做一件事。

### 例子

好：

```
feat(kernel): 增加事件日志的 revision 追赶

store 重启后需要让前端补齐断线期间的事件，
因此事件日志必须暴露从某个 revision 开始的读取接口。

Refs: #12
```

坏：

```
update stuff
```

```
fix: 修改了一些问题，更新了相关逻辑，并且调整了测试
```

第二个坏在：subject 太长、信息为零、多件事混在一起。

## 2. 提交颗粒度：按事件，不按文件

每一次代码变更都必须提交，但**一次提交只表达一个事件**。

- 一个功能点 + 它的测试 = 一个提交；
- 重构与功能分开；
- 文档与代码若属于同一决策可以合并，否则分开；
- 不要攒一天再提交；完成一个可验证的步骤就提交；
- 不把无关格式化混进来。

判断标准：**这条提交能不能用一句话说清"它改变了什么行为"？** 不能，就拆。

## 3. 分支

- 从 `main` 拉出；命名 `type/short-slug`，小写 kebab，≤ 50 字符。
  例：`feat/idea-capture`、`fix/event-replay`、`docs/architecture`。
- 分支短命，合并后删除。
- **禁止直接向 `main` 提交或推送。**
- **禁止本地合并到 `main`。** 主分支只能通过 PR 更新。

## 4. 推送

- 推送**分支**，不推送 `main`。
- 禁止对 `main` 执行 `push` / `force-push`；仓库侧会加保护规则。
- 自己的分支在评审前可以用 `--force-with-lease`；评审后不要改写。
- 禁止 `--no-verify`；钩子有问题就修钩子。

## 5. PR

必须走 PR，禁止本地合并。

### PR 标题

与提交标题同格式：`type(scope): subject`。

### PR 描述

1. 改了什么
2. 为什么
3. 怎么验证（命令 + 输出摘要）
4. 风险与回滚
5. 协议影响（有 / 无）

### 合并方式

**必须使用 merge commit（非线性历史）。**

- 禁止 squash merge；
- 禁止 rebase merge；
- 禁止开启"要求线性历史"。

原因：这个项目的价值之一就是**可追溯**。线性化会把"哪些提交属于同一次变更、为什么这样合并"这层信息抹掉。merge commit 保留分支边界与合并决策，这才是项目历史该有的样子。

### 合并前置条件

- 验证通过；
- 测试通过；
- 基础安全检查通过（secret scanning、依赖变更审查）；
- 有评审时，评审通过；
- 与 `main` 无冲突。

## 6. 安全

- 不提交密钥、token、本地数据。
- 依赖变更单独提交，并在 PR 里说明理由。
- 安全扫描失败时停下来，不要绕过。

## 7. 出错了怎么办

| 情况 | 处理 |
|---|---|
| 提交信息写错、还没推送 | 在自己的分支上 `git commit --amend` |
| 已推送、未评审 | 用 `--force-with-lease` 修正自己的分支 |
| 已评审 / 已合并 | 不改写历史；追加修复提交，或 `git revert` |
| 合并进 `main` 的变更有问题 | `git revert -m 1 <merge-sha>` |

**永远不要改写 `main` 的历史。**

## 8. 机器检查

仓库启用了两个钩子（`git config core.hooksPath .githooks`）：

- `commit-msg`：校验格式与字数（`scripts/commit_msg.py`）；
- `pre-push`：拒绝推送到 `main`。

钩子拦不住的（比如"这条提交是不是只做了一件事"），靠第 2 节的标准和评审。

## 9. 提交前清单

- [ ] 只做了一件事
- [ ] 标题 ≤ 72，subject 4–50
- [ ] 类型与 scope 正确
- [ ] 正文解释了 what / why，每行 ≤ 72
- [ ] 验证通过
- [ ] 没有密钥与本地生成物
- [ ] 分支名符合 `type/slug`

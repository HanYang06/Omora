# 迁移

> 数据迁移按**发布版本**冻结，不按 commit。开发期的 schema 变更不做迁移承诺。

## 1. 规则

- 只有发布了，才冻结一个 schema 版本，并写一条从上一个发布版到当前版的迁移。
- 一个发布最多一条迁移：500 个 commit 改了多少次 schema 都压成一条。
- 没有发布就没有迁移。
- manager 的 `settings` collection 存插件开关，是普通 collection：字段变了按本节处理，不参与领域 schema 的版本。
- 迁移是独立模块；日常改 schema 不顺手写。

## 2. 版本

- `store.SCHEMA_VERSION`（整数）是代码里的 schema 版本；数据库里存 `PRAGMA user_version`。
- 开发期可以随便改 `SCHEMA_VERSION` 和字段；本地库可丢。
- 第一次发布冻结当前 schema；此后每次发布前 schema 变了就递增。

## 3. 开发模式

- `scripts/dev.py` 给内核设 `OMORA_DEV=1`；发布构建不设。
- 版本不一致，或 collection 的字段声明和库里不一致：
  - **开发模式**：重置（删本地库 / 重建 collection），本地数据不要了。
  - **发布模式**：报错退出，**不静默毁数据**。

## 4. 发布清单

1. schema 变了 → `SCHEMA_VERSION += 1`。
2. 写 `migrations/<from>_to_<to>` 的迁移，由 runner 应用。
3. 加 fixture 测试：上一发布版的库 → 当前版本，数据还在。
4. release notes 写 schema 版本。

## 5. 还没做

- 迁移 runner：等第一次发布再实现；现在没有已发布版本要迁。
- 迁移前的备份 / 失败回滚。

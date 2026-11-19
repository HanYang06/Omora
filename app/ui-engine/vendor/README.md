# vendor

薅来的上游源码放这里，一个上游一个目录。规则见 `.agents/skills/omora-project/SKILL.md` 的「依赖：默认买，自写要举证」。

目前为空：能当库用的都走 `package.json`；只有 API 改不动、适配层回答不了边界问题时，才把源码放进来。

目录形状：

```text
vendor/<name>/
  UPSTREAM.md   # 上游仓库 / commit / 取用日期 / 为什么 / 改了哪些文件
  LICENSE       # 原始许可证（有 NOTICE 就一起）
  ...           # 源码；改动处用 PATCH 注释标出
```

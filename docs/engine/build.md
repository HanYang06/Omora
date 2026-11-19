# 构建：V1 树的静态产物

> 状态：**现状**（2026-11-20）。构建期把真实页面 compose 成每页一份 `dendro.tree/1` 文档，
> 产物在 `dist/tree/`，由 `?engine=tree` 预览消费。默认主会话不读构建产物：它连 Python
> 拉 `ui.tree`，两者同形。
> 相关：[V1 树](../planning/v1-tree.md) · [wire](wire.md) · [ADR-0004](decisions/0004-static-tree-minimal-updates.md)

## 0. 一句话

构建只做两件事：把结构组合出来，把产物放到该在的地方。
**首帧不再预编译**：`index.html` 只有空 `#root`，V1 主会话连接后挂载。

## 1. 输入从哪来

`scripts/static_tree.py` 在空数据下跑系统插件，把每页的 `omora.sdk.ui` Page 树升成
V1 构建输入：

```text
插件 build() / set(Page) → ui.page_tree(name) → sdk/tree_build.py
  → base 文档（app 根 + 导航 / 主区 + 这一页的容器 + 页面侧表）
  → 导航局部树（每页一条）+ 页面内容局部树
  → src/generated/static-tree.json（提交；--check 防漂移）
```

- 页面仍是插件写的 Page / Node；V1 接管直接在插件里产节点的能力之前，这层桥保留。
- id 由逻辑 key 经 blake2b 派生（16 位小写十六进制）；`chain = 父 chain + '.' + id`；
  `order = 兄弟下标 × 10`。同一页重建得到同一批 id。
- 静态产物不带 handler（`on` 为空）、`bind` / `emit` 为空对象；事件与数据属于运行时。

## 2. 构建做什么

```text
vite build
  treeArtifactsPlugin.buildStart
    static-tree.json → composeTree(base, partials)（逐页）
    → 形状校验 → emitFile
  dist/tree/manifest.json
  dist/tree/pages/<name>.json
```

**为什么按页拆**：每页一份文档各自带骨架、导航与页面内容，按路由取用；单文件大小只跟
单页结构有关，不跟页数有关。

**dev 下也有同一批产物**：`vite dev` 没有 dist，`build/vite-tree-dev.ts` 在 `/tree/`
上按请求现算（输入 mtime / size 变了才重算）。`?engine=tree` 在 dev 与 build 下看到同一份东西。

manifest 形状（`format: omora.tree.build/1`；`hash` 为文档 sha256 前 16 位，`nodes` 递归数）：

```json
{
  "format": "omora.tree.build/1",
  "default": "ideas",
  "pages": [
    {
      "name": "ideas",
      "title": "灵感",
      "route": "/ideas",
      "file": "tree/pages/ideas.json",
      "hash": "…",
      "nodes": 22
    }
  ]
}
```

## 3. 门禁

| 命令                                           | 查什么                                                                       |
| ---------------------------------------------- | ---------------------------------------------------------------------------- |
| `uv run python scripts/static_tree.py --check` | 输入是否最新                                                                 |
| `vite build` 的 `treeArtifactsPlugin`          | 每页 compose、kind 是否存在（`E-TREE-KIND`）；失败让构建失败                 |
| `uv run python scripts/tree_artifacts.py`      | 产物：Python 语义校验（chain / id / order / pages / active）、hash、文件集合 |

分工：构建期只做形状与组合；语义权威仍是 Python，产物落盘后验一遍。

## 4. 还没接的

- 默认主会话不读 `dist/tree`（它拉 Python 的 `ui.tree`）；`dist/tree` 只服务 `?engine=tree` 预览。
- 静态产物没有事件 / 数据；导航在预览里是禁用态。
- 类型检查只做 kind 存在性；per-kind `settings` schema、`on` / `bind` 引用未查。
- 首帧没有预渲染（旧 Slot 启动骨架已删除）。

# 构建：V1 树的静态产物

> 状态：**已落**（2026-11-18）。构建期把真实页面 compose 成每页一份 `dendro.tree/1` 文档，
> 产物在 `dist/tree/`；运行时还没消费（下一步）。
> 相关：[V1 树](../planning/v1-tree.md) · [renderer.md](renderer.md) · [ADR-0004](decisions/0004-static-tree-minimal-updates.md)

## 0. 一句话

构建只做两件事：把结构组合出来，把产物放到该在的地方。它不关心前端最终长什么样。

## 1. 输入从哪来

`scripts/static_tree.py` 在空数据下跑系统插件，把每页的 `omora.sdk.ui` 页面树升成 V1 输入：

```text
插件 build() → ui.page_tree(name) → sdk/tree_build.py
  → base 文档（app 根 + 导航 / 主区 + 这一页的容器 + 页面侧表）
  → 导航局部树（每页一条）+ 页面内容局部树
  → src/generated/static-tree.json（提交；--check 防漂移）
```

- 这是迁移桥：插件仍按旧 Node 写页面；V1 接管后桥删除。
- id 由逻辑 key 经 blake2b 派生（16 位小写十六进制）；`chain = 父 chain + '.' + id`；
  `order = 兄弟下标 × 10`。同一页重建得到同一批 id。
- 事件暂不落树（`on` 为空），`bind` / `emit` 为空对象；绑定与最小更新属于引擎那一半。

## 2. 构建做什么

```text
vite build
  treeArtifactsPlugin.buildStart
    static-tree.json → composeTree(base, partials)（逐页）
    → 形状校验 → emitFile
  dist/tree/manifest.json
  dist/tree/pages/<name>.json
```

**为什么按页拆**：一棵树只有一份文档时，页数一多就是巨无霸。每页一份文档各自带骨架、导航
与页面内容，按路由取用；单个文件的大小只跟单页结构有关，不跟页数有关。

manifest 形状：

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
      "hash": "...",
      "nodes": 22
    }
  ]
}
```

`hash` 是文档 JSON 的 sha256 前 16 位；`nodes` 是节点数（layout 与 `collection.templates` 递归）。

## 3. 门禁

| 命令                                           | 查什么                                                                       |
| ---------------------------------------------- | ---------------------------------------------------------------------------- |
| `uv run python scripts/static_tree.py --check` | 输入是否最新                                                                 |
| `vite build` 的 `treeArtifactsPlugin`          | 每页 compose 是否成功、每个 kind 是否有实现（`E-TREE-KIND`）；失败让构建失败 |
| `uv run python scripts/tree_artifacts.py`      | 产物：Python 语义校验（chain / id / order / pages / active）、hash、文件集合 |

分工：构建期只做形状与组合；语义权威仍是 Python，在产物落盘后验一遍。

## 4. 还没接的

- 运行时还没读 `dist/tree`：默认入口仍是 Slot 骨架 + Slot 主会话。
- 首帧 HTML 仍由 Slot 骨架编译（`src/build/boot-skeleton.ts`）。
- 事件 / 数据 / 最小更新还没进这份产物；下一步是 DOM host + V1 运行时 + ops。
- 类型检查只做了 kind 存在性；per-kind `settings` schema、`on` / `bind` 引用仍未查。

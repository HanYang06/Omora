"""给节点挂 bind：prop ← 集合条目字段（`item.title` / 裸 `title`）。

节点仍是 `omora.sdk.ui` 的 frozen dataclass；`bound()` 只补一个不参与 settings 的
`bind_props` 属性，`tree_build` 序列化时写进节点的 `bind`。集合模板靠它把条目
字段投影到 settings——实例不保留 `bind`，运行时按条目求值。
"""

from __future__ import annotations

from .ui import Node


def bound[T: Node](node: T, **props: str) -> T:
    """返回同一个节点，挂上 prop → 条目路径的绑定；每一条都必须非空。"""
    if not props:
        raise ValueError("bound 至少要一条绑定")
    for name, path in props.items():
        if not isinstance(name, str) or name.strip() == "":
            raise ValueError("bind 的 prop 名必须是非空字符串")
        if not isinstance(path, str) or path.strip() == "":
            raise ValueError(f"bind.{name} 必须是非空字符串")
    merged = {**getattr(node, "bind_props", {}), **props}
    object.__setattr__(node, "bind_props", merged)
    return node


__all__ = ["bound"]

"""给节点挂稳定身份 key（列表项用）。

节点本身仍是 `omora.sdk.ui` 的 frozen dataclass；`keyed()` 只补一个不参与
props 的 `id_key` 属性，序列化时用它代替兄弟下标，插入/重排不会让后面的 id 漂。
"""

from __future__ import annotations

from .ui import Node


def keyed[T: Node](node: T, key: str) -> T:
    """返回同一个节点，挂上 `id_key`；key 必须非空。"""
    if not isinstance(key, str) or key == "":
        raise ValueError("key 必须是非空字符串")
    object.__setattr__(node, "id_key", key)
    return node


__all__ = ["keyed"]

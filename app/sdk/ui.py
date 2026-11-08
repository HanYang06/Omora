"""界面节点：插件用 Python 写，TS 负责画。

内核不认识这些；sdk 只保证它们能变成一串纯数据。
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, fields
from typing import Any, ClassVar

Handler = Callable[[], None]


@dataclass(frozen=True)
class Node:
    """所有组件的共同底座。"""

    type: ClassVar[str] = ""


@dataclass(frozen=True, init=False)
class Column(Node):
    type: ClassVar[str] = "column"
    children: tuple[Node, ...]

    def __init__(self, *children: Node) -> None:
        object.__setattr__(self, "children", tuple(children))


@dataclass(frozen=True, init=False)
class Row(Node):
    type: ClassVar[str] = "row"
    children: tuple[Node, ...]

    def __init__(self, *children: Node) -> None:
        object.__setattr__(self, "children", tuple(children))


@dataclass(frozen=True)
class Text(Node):
    type: ClassVar[str] = "text"
    text: str = ""
    kind: str | None = None


@dataclass(frozen=True)
class Button(Node):
    type: ClassVar[str] = "button"
    text: str = ""
    on_click: Handler | None = None


def serialize(node: Node, register: Callable[[Handler], str]) -> dict[str, Any]:
    """节点 → `{type, props, children}`。回调交给 register 换成 id。"""
    props: dict[str, Any] = {}
    children: list[dict[str, Any]] = []

    for field in fields(node):
        value: Any = getattr(node, field.name)
        if field.name == "children":
            children = [serialize(child, register) for child in value]
        elif callable(value):
            props[field.name] = register(value)
        elif value is not None:
            props[field.name] = value

    return {"type": node.type, "props": props, "children": children}


__all__ = ["Button", "Column", "Node", "Row", "Text", "serialize"]

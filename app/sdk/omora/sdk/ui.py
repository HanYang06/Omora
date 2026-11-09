"""界面节点：插件用 Python 写，TS 负责画。

内核不认识这些；sdk 只保证它们能变成一串纯数据。
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, fields
from typing import Any, ClassVar

Handler = Callable[[dict[str, Any]], None]


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


@dataclass(frozen=True, init=False)
class List(Node):
    """一条一条的清单。账本行的容器。"""

    type: ClassVar[str] = "list"
    children: tuple[Node, ...]

    def __init__(self, *items: Node) -> None:
        object.__setattr__(self, "children", tuple(items))


@dataclass(frozen=True, init=False)
class Item(Node):
    """清单里的一行：左栏 meta，右边标题，子节点是这一行的动作。"""

    type: ClassVar[str] = "item"
    meta: str
    title: str
    children: tuple[Node, ...]

    def __init__(self, meta: str, title: str, *actions: Node) -> None:
        object.__setattr__(self, "meta", meta)
        object.__setattr__(self, "title", title)
        object.__setattr__(self, "children", tuple(actions))


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
    variant: str | None = None


@dataclass(frozen=True)
class Input(Node):
    """一行捕捉：回车把值交回去。"""

    type: ClassVar[str] = "input"
    placeholder: str = ""
    on_submit: Handler | None = None


@dataclass(frozen=True)
class Empty(Node):
    type: ClassVar[str] = "empty"
    title: str = ""
    hint: str | None = None


@dataclass(frozen=True)
class Recorder(Node):
    """录音条：录完把音频交给 on_submit。"""

    type: ClassVar[str] = "recorder"
    on_submit: Handler | None = None


@dataclass(frozen=True)
class Audio(Node):
    """一条音频：media 是 media 插件给的 id。"""

    type: ClassVar[str] = "audio"
    media: str = ""


@dataclass(frozen=True)
class Page:
    """一页：内容 + 标题旁的那句话（比如“12 条”）。标题用登记页面时的标签。"""

    content: Node
    meta: str = ""


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


__all__ = [
    "Audio",
    "Button",
    "Column",
    "Empty",
    "Handler",
    "Input",
    "Item",
    "List",
    "Node",
    "Page",
    "Recorder",
    "Row",
    "Text",
    "serialize",
]
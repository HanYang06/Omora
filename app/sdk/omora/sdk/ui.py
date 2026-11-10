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
    """清单里的一行：左栏 meta，右边标题，子节点是这一行的动作。

    on_click 让整行可点（索引栏用）；不给就是一个静态行。
    """

    type: ClassVar[str] = "item"
    meta: str
    title: str
    on_click: Handler | None
    children: tuple[Node, ...]

    def __init__(
        self, meta: str, title: str, *actions: Node, on_click: Handler | None = None
    ) -> None:
        object.__setattr__(self, "meta", meta)
        object.__setattr__(self, "title", title)
        object.__setattr__(self, "on_click", on_click)
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


@dataclass(frozen=True, init=False)
class Search(Node):
    """搜索框：打字（防抖）交回 on_query，回车或按钮交回 on_submit。

    子节点是建议：下拉里按顺序列出来，上下键选，回车就按选中项提交。
    引擎只管防抖、键盘和画下拉；搜什么、怎么排，全在插件里。
    """

    type: ClassVar[str] = "search"
    placeholder: str
    value: str
    on_query: Handler | None
    on_submit: Handler | None
    children: tuple[Node, ...]

    def __init__(
        self,
        *suggestions: Node,
        placeholder: str = "",
        value: str = "",
        on_query: Handler | None = None,
        on_submit: Handler | None = None,
    ) -> None:
        object.__setattr__(self, "placeholder", placeholder)
        object.__setattr__(self, "value", value)
        object.__setattr__(self, "on_query", on_query)
        object.__setattr__(self, "on_submit", on_submit)
        object.__setattr__(self, "children", tuple(suggestions))


@dataclass(frozen=True)
class Suggestion(Node):
    """下拉里的一条建议：value 是选中后提交的查询，title 是给人看的。"""

    type: ClassVar[str] = "suggestion"
    value: str = ""
    title: str = ""
    meta: str | None = None
    highlight: str | None = None
    on_pick: Handler | None = None


@dataclass(frozen=True)
class Result(Node):
    """一条搜索结果：标题可点，snippet 里 highlight 那几个字标出来。"""

    type: ClassVar[str] = "result"
    title: str = ""
    snippet: str = ""
    meta: str = ""
    highlight: str | None = None
    on_click: Handler | None = None


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
class AudioCapture(Node):
    """音频捕捉条：录完把 base64 音频交给 on_submit。

    设备、权限、热插拔由客户端检测；这里只给质量档与时限。
    """

    type: ClassVar[str] = "audio_capture"
    on_submit: Handler | None = None
    quality: str | None = None
    noise_reduction: bool | None = None
    max_seconds: int | None = None


@dataclass(frozen=True)
class VideoCapture(Node):
    """视频捕捉条：录完先传 HTTP 媒体通道，再把 media id 交给 on_submit。"""

    type: ClassVar[str] = "video_capture"
    on_submit: Handler | None = None
    upload_url: str | None = None
    quality: str | None = None
    max_seconds: int | None = None


@dataclass(frozen=True)
class Video(Node):
    """一条视频：media 是 media 插件给的 id，src 是 HTTP 媒体通道的播放地址。"""

    type: ClassVar[str] = "video"
    media: str = ""
    src: str | None = None


@dataclass(frozen=True, init=False)
class Split(Node):
    """两栏：先侧栏后主区。侧栏宽度固定，主区吃剩下的。"""

    type: ClassVar[str] = "split"
    children: tuple[Node, ...]

    def __init__(self, side: Node, main: Node) -> None:
        object.__setattr__(self, "children", (side, main))


@dataclass(frozen=True, init=False)
class Rail(Node):
    """索引栏：一个标题加一串条目，自己滚动。"""

    type: ClassVar[str] = "rail"
    title: str
    children: tuple[Node, ...]

    def __init__(self, title: str, *items: Node) -> None:
        object.__setattr__(self, "title", title)
        object.__setattr__(self, "children", tuple(items))


@dataclass(frozen=True)
class Icon(Node):
    """一个图标：name 是词表里的名字，引擎认不出就画一个空位。"""

    type: ClassVar[str] = "icon"
    name: str = ""


@dataclass(frozen=True)
class Tile(Node):
    """捕捉大按钮：图标 + 标题 + 一句说明。"""

    type: ClassVar[str] = "tile"
    icon: str = ""
    title: str = ""
    hint: str = ""
    on_click: Handler | None = None


@dataclass(frozen=True)
class Chip(Node):
    """工具条上的小按钮；active 只是样子。"""

    type: ClassVar[str] = "chip"
    text: str = ""
    active: bool = False
    on_click: Handler | None = None


@dataclass(frozen=True, init=False)
class Card(Node):
    """推荐卡片：标题 + 一句正文 + 时间；子节点是可选的媒体。"""

    type: ClassVar[str] = "card"
    title: str
    text: str
    meta: str
    on_click: Handler | None
    children: tuple[Node, ...]

    def __init__(
        self,
        title: str,
        text: str = "",
        meta: str = "",
        *,
        on_click: Handler | None = None,
        children: tuple[Node, ...] = (),
    ) -> None:
        object.__setattr__(self, "title", title)
        object.__setattr__(self, "text", text)
        object.__setattr__(self, "meta", meta)
        object.__setattr__(self, "on_click", on_click)
        object.__setattr__(self, "children", tuple(children))


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
    "AudioCapture",
    "Button",
    "Card",
    "Chip",
    "Column",
    "Empty",
    "Handler",
    "Icon",
    "Input",
    "Item",
    "List",
    "Node",
    "Page",
    "Rail",
    "Recorder",
    "Result",
    "Row",
    "Search",
    "Split",
    "Suggestion",
    "Text",
    "Tile",
    "Video",
    "VideoCapture",
    "serialize",
]
"""表单与反馈控件：与引擎的 `render/controls/` 一一对应。

这些节点只描述"是什么、收什么"，行为在引擎里（开合、勾选、拖动都是组件自己的局部状态）。
事件统一 `on_change`，载荷见 `events.Change`；`Textarea` 是 `on_submit`。
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import ClassVar

from .events import Change, Submit
from .ui import Node, Text

Handler = Callable[[dict[str, object]], None]
"""旧写法也收：裸 dict 的回调照样能挂上来。"""

ChangeHandler = Callable[[Change], None]
"""控件变化的回调：载荷是 `{"value": ...}`。"""

SubmitHandler = Callable[[Submit], None]
"""提交的回调：载荷是 `{"value": "..."}`。"""


@dataclass(frozen=True)
class Switch(Node):
    """开关：checked 由数据决定，拨一下把新值交回去。"""

    type: ClassVar[str] = "switch"
    text: str = ""
    checked: bool = False
    disabled: bool | None = None
    on_change: ChangeHandler | None = None


@dataclass(frozen=True)
class Checkbox(Node):
    """复选：checked 由数据决定，勾一下把新值交回去。"""

    type: ClassVar[str] = "checkbox"
    text: str = ""
    checked: bool = False
    disabled: bool | None = None
    on_change: ChangeHandler | None = None


@dataclass(frozen=True)
class Radio(Node):
    """单选：同一 name 是一组，value 是提交值。"""

    type: ClassVar[str] = "radio"
    text: str = ""
    name: str = ""
    value: str = ""
    checked: bool = False
    disabled: bool | None = None
    on_change: ChangeHandler | None = None


@dataclass(frozen=True, init=False)
class Select(Node):
    """下拉：子节点是选项（`Text`，props.value 缺省取文字）。"""

    type: ClassVar[str] = "select"
    value: str
    placeholder: str | None
    disabled: bool
    on_change: Handler | None
    children: tuple[Node, ...]

    def __init__(
        self,
        *options: Text,
        value: str = "",
        placeholder: str | None = None,
        disabled: bool | None = None,
        on_change: ChangeHandler | None = None,
    ) -> None:
        object.__setattr__(self, "value", value)
        object.__setattr__(self, "placeholder", placeholder)
        object.__setattr__(self, "disabled", disabled)
        object.__setattr__(self, "on_change", on_change)
        object.__setattr__(self, "children", tuple(options))


@dataclass(frozen=True)
class Option(Text):
    """下拉选项：文字给人看，value 是提交值（缺省同文字）；type 仍是 text。"""

    value: str | None = None


@dataclass(frozen=True)
class Textarea(Node):
    """多行输入：失焦或 Ctrl/Cmd + Enter 提交，普通回车换行。"""

    type: ClassVar[str] = "textarea"
    placeholder: str = ""
    value: str | None = None
    rows: int | None = None
    disabled: bool | None = None
    on_submit: SubmitHandler | None = None


@dataclass(frozen=True)
class NumberInput(Node):
    """数字输入：回传 number，空值不回传。"""

    type: ClassVar[str] = "number_input"
    value: float | None = None
    min: float | None = None
    max: float | None = None
    step: float | None = None
    disabled: bool | None = None
    on_change: ChangeHandler | None = None


@dataclass(frozen=True)
class Slider(Node):
    """拖动条：拖动中不回弹，每个变化都回传 number。"""

    type: ClassVar[str] = "slider"
    value: float | None = None
    min: float | None = None
    max: float | None = None
    step: float | None = None
    disabled: bool | None = None
    on_change: ChangeHandler | None = None


@dataclass(frozen=True, init=False)
class Field(Node):
    """一行表单：label 在上，控件在下，可选一句 hint；子节点是控件。"""

    type: ClassVar[str] = "field"
    label: str
    hint: str | None
    children: tuple[Node, ...]

    def __init__(self, label: str, *children: Node, hint: str | None = None) -> None:
        object.__setattr__(self, "label", label)
        object.__setattr__(self, "hint", hint)
        object.__setattr__(self, "children", tuple(children))


@dataclass(frozen=True, init=False)
class ButtonGroup(Node):
    """一组按钮排成一段；子节点是 Button。"""

    type: ClassVar[str] = "button_group"
    children: tuple[Node, ...]

    def __init__(self, *buttons: Node) -> None:
        object.__setattr__(self, "children", tuple(buttons))


@dataclass(frozen=True, init=False)
class Tabs(Node):
    """标签页：子节点是每一页，子节点的 label（缺省 title / text）是标签名。"""

    type: ClassVar[str] = "tabs"
    children: tuple[Node, ...]

    def __init__(self, *panels: Node) -> None:
        object.__setattr__(self, "children", tuple(panels))


@dataclass(frozen=True, init=False)
class Accordion(Node):
    """折叠面板：子节点是每一节，同上取标题；open 给初始展开的那一节。"""

    type: ClassVar[str] = "accordion"
    open: int | None
    children: tuple[Node, ...]

    def __init__(self, *sections: Node, open: int | None = None) -> None:
        object.__setattr__(self, "open", open)
        object.__setattr__(self, "children", tuple(sections))


@dataclass(frozen=True)
class Progress(Node):
    """进度条：value / max 决定填充，text 是下面那行说明。"""

    type: ClassVar[str] = "progress"
    value: float = 0
    max: float = 100
    text: str = ""


__all__ = [
    "Accordion",
    "ButtonGroup",
    "Checkbox",
    "Field",
    "NumberInput",
    "Option",
    "Progress",
    "Radio",
    "Select",
    "Slider",
    "Switch",
    "Tabs",
    "Textarea",
]

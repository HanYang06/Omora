"""控件节点：与引擎 `render/controls/` 的契约一致（type 名、props、children）。"""

from __future__ import annotations

from typing import Any

from omora.sdk.controls import (
    Accordion,
    ButtonGroup,
    Checkbox,
    Field,
    NumberInput,
    Option,
    Progress,
    Radio,
    Select,
    Slider,
    Switch,
    Tabs,
    Textarea,
)
from omora.sdk.events import Change, Submit
from omora.sdk.ui import Button, Handler, Text, serialize


def _ids(*names: str) -> Any:
    remaining = iter(names)

    def register(_handler: Handler) -> str:
        return next(remaining)

    return register


def _noop(_payload: Any) -> None:
    pass


def test_switch_carries_text_checked_and_handler() -> None:
    node = Switch("降噪", checked=True, on_change=_noop)

    assert serialize(node, _ids("h0")) == {
        "type": "switch",
        "props": {"text": "降噪", "checked": True, "on_change": "h0"},
        "children": [],
    }


def test_switch_without_handler_drops_it() -> None:
    assert serialize(Switch("降噪"), _ids())["props"] == {"text": "降噪", "checked": False}


def test_checkbox_and_radio_follow_the_same_shape() -> None:
    checkbox = serialize(Checkbox("完成", checked=False), _ids())
    radio = serialize(Radio("高", name="quality", value="high", checked=True), _ids())

    assert checkbox["type"] == "checkbox"
    assert checkbox["props"] == {"text": "完成", "checked": False}
    assert radio["props"] == {
        "text": "高",
        "name": "quality",
        "value": "high",
        "checked": True,
    }


def test_select_keeps_options_as_children() -> None:
    node = Select(Option("高", value="high"), Text("低"), value="high", placeholder="音质")

    serialized = serialize(node, _ids())

    assert serialized["props"] == {"value": "high", "placeholder": "音质"}
    assert [child["props"] for child in serialized["children"]] == [
        {"text": "高", "value": "high"},
        {"text": "低"},
    ]


def test_textarea_submits_on_its_own_verb() -> None:
    node = Textarea(placeholder="记一笔", rows=4, on_submit=_noop)

    assert serialize(node, _ids("h0"))["props"] == {
        "placeholder": "记一笔",
        "rows": 4,
        "on_submit": "h0",
    }


def test_numbers_go_out_as_numbers() -> None:
    serialized = serialize(NumberInput(value=3, min=0, max=10, step=1, on_change=_noop), _ids("h0"))
    slider = serialize(Slider(value=50, min=0, max=100), _ids())

    assert serialized["props"] == {"value": 3, "min": 0, "max": 10, "step": 1, "on_change": "h0"}
    assert slider["props"] == {"value": 50, "min": 0, "max": 100}


def test_field_and_button_group_keep_their_children() -> None:
    field = serialize(Field("音质", Switch("降噪"), hint="默认开"), _ids())
    group = serialize(ButtonGroup(Button("保存"), Button("取消")), _ids())

    assert field["props"] == {"label": "音质", "hint": "默认开"}
    assert [child["type"] for child in field["children"]] == ["switch"]
    assert [child["type"] for child in group["children"]] == ["button", "button"]


def test_tabs_and_accordion_carry_panels() -> None:
    tabs = serialize(Tabs(Text("一"), Text("二")), _ids())
    accordion = serialize(Accordion(Text("一")), _ids())

    assert [child["props"]["text"] for child in tabs["children"]] == ["一", "二"]
    assert "open" not in accordion["props"]


def test_accordion_open_is_only_written_when_given() -> None:
    assert serialize(Accordion(Text("一"), open=0), _ids())["props"]["open"] == 0


def test_progress_carries_value_and_caption() -> None:
    assert serialize(Progress(value=30, max=60, text="一半"), _ids())["props"] == {
        "value": 30,
        "max": 60,
        "text": "一半",
    }


def test_event_payload_types_describe_what_handlers_get() -> None:
    change: Change = {"value": True}
    submit: Submit = {"value": "买牛奶"}

    assert change["value"] is True
    assert submit["value"] == "买牛奶"

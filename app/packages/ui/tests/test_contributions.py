"""贡献：别的插件往一个键挂树，归属与事件都回到它自己。

这里不装内核：ui 与 Context 直接构造，重点钉的是形状、归属和撤销。
"""

from __future__ import annotations

from typing import Any

from omora.core.context import Context
from omora.sdk.ui import Button, Column, Node, Page, Slot
from omora.ui import Ui

KEY = "ideas.home.after_capture"


def _text_button() -> Node:
    return Button("录音")


def _ui() -> tuple[Ui, Context, Context]:
    ui = Ui()
    ideas = Context(name="ideas")
    audio = Context(name="audio")

    def build_page() -> Page:
        return Page(Column(Slot(key=KEY)))

    ui.page(ideas, "ideas", "灵感", build_page)
    return ui, ideas, audio


def test_contribution_is_wrapped_with_owner_and_target() -> None:
    ui, _, audio = _ui()

    def build() -> Node:
        return Button("录音")

    ui.contribute(audio, KEY, build, order=20)
    snapshot = ui.render()

    assert snapshot["content"]["children"][0] == {
        "type": "slot",
        "props": {"key": KEY},
        "children": [],
    }
    assert snapshot["contributions"] == [
        {
            "owner": "audio",
            "target": KEY,
            "op": "append",
            "order": 20,
            "seq": 1,
            "tree": {"type": "button", "props": {"text": "录音"}, "children": []},
        }
    ]


def test_contribution_handlers_carry_their_owner() -> None:
    ui, _, audio = _ui()
    clicked: list[dict[str, Any]] = []

    def build() -> Node:
        return Button("录音", on_click=clicked.append)

    ui.contribute(audio, KEY, build)
    handler = str(ui.render()["contributions"][0]["tree"]["props"]["on_click"])

    assert handler.startswith("audio:")
    assert ui.event(handler, {"value": 1}) == {}
    assert clicked == [{"value": 1}]


def test_dispose_removes_the_contribution() -> None:
    ui, _, audio = _ui()
    ui.contribute(audio, KEY, _text_button)
    assert len(ui.render()["contributions"]) == 1

    audio.dispose()
    assert ui.render()["contributions"] == []


def test_broken_contribution_is_skipped() -> None:
    ui, _, audio = _ui()

    def boom() -> Node:
        raise RuntimeError("boom")

    ui.contribute(audio, KEY, boom)
    snapshot = ui.render()

    assert snapshot["contributions"] == []
    assert snapshot["content"]["children"][0]["props"]["key"] == KEY


def test_order_and_seq_follow_registration() -> None:
    ui, _, audio = _ui()
    ui.contribute(audio, KEY, lambda: Button("先"), order=30)
    ui.contribute(audio, KEY, lambda: Button("后"))

    items = ui.render()["contributions"]
    assert [(item["order"], item["seq"]) for item in items] == [(30, 1), (0, 2)]

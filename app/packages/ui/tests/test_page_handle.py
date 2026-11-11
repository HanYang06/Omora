"""页面对象：插件自己交树（推送式），不再把 build 回调交给 ui。"""

from __future__ import annotations

import json
from typing import Any

import pytest

from omora.core.context import Context
from omora.sdk.ui import Button, Column, Page, Text
from omora.ui import Ui


class _Net:
    """net 的替身：记下推出去的东西，不解释。"""

    def __init__(self) -> None:
        self.sent: list[dict[str, Any]] = []

    def emit(self, topic: str, payload: dict[str, Any], *, coalesce: bool = False) -> None:
        self.sent.append(payload)


def _ui() -> tuple[Ui, Context, _Net]:
    net = _Net()
    ctx = Context(name="notes")
    ctx.provide("net", net)
    return Ui(ctx=ctx), ctx, net


def test_a_page_can_be_set_without_a_build_callback() -> None:
    ui, ctx, _ = _ui()
    handle = ui.page(ctx, "notes", "笔记")
    handle.set(Page(Column(Text("第一条"))))

    snapshot = ui.render("notes")

    assert snapshot["content"]["children"][0] == {
        "type": "text",
        "props": {"text": "第一条"},
        "children": [],
    }


def test_rendering_before_a_tree_is_set_is_an_error() -> None:
    ui, ctx, _ = _ui()
    ui.page(ctx, "notes", "笔记")

    with pytest.raises(LookupError, match="还没交树"):
        ui.render("notes")


def test_set_inside_an_event_updates_the_view() -> None:
    ui, ctx, net = _ui()
    handle = ui.page(ctx, "notes", "笔记")

    def click(_payload: dict[str, Any]) -> None:
        handle.set(Page(Column(Text("点过了"))))

    handle.set(Page(Column(Button("点", on_click=click))))
    snapshot = ui.render("notes")
    handler = str(snapshot["content"]["children"][0]["props"]["on_click"])

    assert ui.event(handler, {}) == {}
    assert "点过了" in json.dumps(net.sent[-1], ensure_ascii=False)


def test_refresh_pushes_the_current_tree_again() -> None:
    ui, ctx, net = _ui()
    handle = ui.page(ctx, "notes", "笔记")
    handle.set(Page(Column(Text("第一条"))))
    ui.render("notes")
    before = len(net.sent)

    handle.refresh()

    assert len(net.sent) == before + 1
    assert "第一条" in json.dumps(net.sent[-1], ensure_ascii=False)


def test_set_outside_an_event_pushes_to_the_open_page() -> None:
    ui, ctx, net = _ui()
    handle = ui.page(ctx, "notes", "笔记")
    handle.set(Page(Column(Text("第一条"))))
    ui.render("notes")
    before = len(net.sent)

    handle.set(Page(Column(Text("第二条"))))

    assert len(net.sent) == before + 1
    assert "第二条" in json.dumps(net.sent[-1], ensure_ascii=False)

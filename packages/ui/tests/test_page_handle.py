"""页面对象：插件自己交树（推送式），不再把 build 回调交给 ui。"""

from __future__ import annotations

from typing import Any, cast

import pytest

from omora.core.context import Context
from omora.sdk.ui import Button, Column, Page, Text
from omora.ui import Ui

PAGE_MOUNT_AT = "dendro.window.page"


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


def _page_root(view: dict[str, Any]) -> dict[str, Any]:
    for tree in cast(list[dict[str, Any]], view["localTrees"]["trees"]):
        if tree["mountAt"] == PAGE_MOUNT_AT:
            return cast(dict[str, Any], tree["root"])
    raise AssertionError("view 里没有页面局部树")


def _walk(slot: dict[str, Any]) -> list[dict[str, Any]]:
    found = [slot]
    for child in slot["children"]:
        found.extend(_walk(child))
    return found


def _texts(view: dict[str, Any]) -> list[str]:
    return [
        str(slot["props"]["text"])
        for slot in _walk(_page_root(view))
        if slot["kind"] == "dendro:text"
    ]


def test_a_page_can_be_set_without_a_build_callback() -> None:
    ui, ctx, _ = _ui()
    handle = ui.page(ctx, "notes", "笔记")
    handle.set(Page(Column(Text("第一条"))))

    view = ui.render("notes")

    assert view["active"] == "page.notes"
    assert _texts(view) == ["第一条"]


def test_rendering_before_a_tree_is_set_is_an_error() -> None:
    ui, ctx, _ = _ui()
    ui.page(ctx, "notes", "笔记")

    with pytest.raises(LookupError, match="还没交树"):
        ui.render("notes")


def test_set_inside_an_event_updates_the_returned_view() -> None:
    ui, ctx, net = _ui()
    handle = ui.page(ctx, "notes", "笔记")

    def click(_payload: dict[str, Any]) -> None:
        handle.set(Page(Column(Text("点过了"))))

    handle.set(Page(Column(Button("点", on_click=click))))
    view = ui.render("notes")
    button = next(slot for slot in _walk(_page_root(view)) if slot["kind"] == "dendro:button")
    handler = str(button["events"]["click"])

    after = ui.event(handler, {})

    assert net.sent == []
    assert "点过了" in _texts(after)


def test_refresh_pushes_the_current_view_again() -> None:
    ui, ctx, net = _ui()
    handle = ui.page(ctx, "notes", "笔记")
    handle.set(Page(Column(Text("第一条"))))
    ui.render("notes")
    before = len(net.sent)

    handle.refresh()

    assert len(net.sent) == before + 1
    assert net.sent[-1]["kind"] == "view"
    assert net.sent[-1]["version"] == 2
    assert "第一条" in _texts(net.sent[-1])


def test_set_outside_an_event_pushes_the_current_view() -> None:
    ui, ctx, net = _ui()
    handle = ui.page(ctx, "notes", "笔记")
    handle.set(Page(Column(Text("第一条"))))
    ui.render("notes")
    before = len(net.sent)

    handle.set(Page(Column(Text("第二条"))))

    assert len(net.sent) == before + 1
    assert net.sent[-1]["kind"] == "view"
    assert net.sent[-1]["version"] == 2
    assert "第二条" in _texts(net.sent[-1])


def test_refresh_of_an_unknown_page_says_so() -> None:
    ui, _, _ = _ui()

    with pytest.raises(LookupError, match="未知页面: missing"):
        ui.refresh_page("missing")


def test_set_page_for_an_unknown_page_says_so() -> None:
    ui, _, _ = _ui()

    with pytest.raises(LookupError, match="未知页面: missing"):
        ui.set_page("missing", Page(Column(Text("没人收"))))


def test_refresh_before_the_first_render_does_not_push() -> None:
    ui, ctx, net = _ui()
    ui.page(ctx, "notes", "笔记")
    ui.page(ctx, "chart", "图表")

    ui.refresh_page("notes")

    assert net.sent == []

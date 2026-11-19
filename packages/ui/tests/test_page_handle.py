"""页面对象：插件自己交树（推送式），下一次 tree() / tree_event 用它重建。"""

from __future__ import annotations

from typing import Any

import pytest

from omora.core.context import Context
from omora.sdk.tree_build import compose
from omora.sdk.ui import Button, Column, Page, Text
from omora.ui import Ui


def _ui() -> tuple[Ui, Context]:
    ctx = Context(name="notes")
    return Ui(), ctx


def _walk(node: dict[str, Any]) -> list[dict[str, Any]]:
    found = [node]
    for child in node["layout"]:
        found.extend(_walk(child))
    return found


def _texts(ui: Ui, page: str | None = None) -> list[str]:
    payload = ui.tree() if page is None else ui.tree(page)
    document = compose(payload["base"], payload["partials"])
    return [
        str(node["settings"]["text"])
        for node in _walk(document["root"])
        if node["kind"] == "text" and "text" in node["settings"]
    ]


def _handler(ui: Ui, text: str, event: str = "click") -> str:
    payload = ui.tree()
    document = compose(payload["base"], payload["partials"])
    for node in _walk(document["root"]):
        if node["kind"] == "button" and node["settings"].get("text") == text:
            return str(node["on"][event])
    raise AssertionError(f"没有按钮: {text}")


def test_a_page_can_be_set_without_a_build_callback() -> None:
    ui, ctx = _ui()
    handle = ui.page(ctx, "notes", "笔记")
    handle.set(Page(Column(Text("第一条"))))

    assert _texts(ui, "notes") == ["第一条"]
    assert ui.active_page == "notes"


def test_rendering_before_a_tree_is_set_is_an_error() -> None:
    ui, ctx = _ui()
    ui.page(ctx, "notes", "笔记")

    with pytest.raises(LookupError, match="还没交树"):
        ui.tree("notes")


def test_set_inside_an_event_updates_the_next_tree() -> None:
    ui, ctx = _ui()
    handle = ui.page(ctx, "notes", "笔记")

    def click(_payload: dict[str, Any]) -> None:
        handle.set(Page(Column(Text("点过了"))))

    handle.set(Page(Column(Button("点", on_click=click))))
    handler = _handler(ui, "点")

    ui.tree_event(handler, {})

    assert "点过了" in _texts(ui, "notes")


def test_set_outside_an_event_is_picked_up_by_the_next_tree() -> None:
    ui, ctx = _ui()
    handle = ui.page(ctx, "notes", "笔记")
    handle.set(Page(Column(Text("第一条"))))
    _texts(ui, "notes")

    handle.set(Page(Column(Text("第二条"))))

    assert "第二条" in _texts(ui, "notes")


def test_refresh_of_a_known_page_is_a_no_op_until_the_next_tree() -> None:
    ui, ctx = _ui()
    handle = ui.page(ctx, "notes", "笔记")
    handle.set(Page(Column(Text("第一条"))))
    _texts(ui, "notes")

    handle.refresh()

    assert "第一条" in _texts(ui, "notes")


def test_refresh_of_an_unknown_page_says_so() -> None:
    ui, _ = _ui()

    with pytest.raises(LookupError, match="未知页面: missing"):
        ui.refresh_page("missing")


def test_set_page_for_an_unknown_page_says_so() -> None:
    ui, _ = _ui()

    with pytest.raises(LookupError, match="未知页面: missing"):
        ui.set_page("missing", Page(Column(Text("没人收"))))


def test_refresh_before_the_first_tree_does_not_fail() -> None:
    ui, ctx = _ui()
    ui.page(ctx, "notes", "笔记")
    ui.page(ctx, "chart", "图表")

    ui.refresh_page("notes")

    assert ui.pages()[0].name == "notes"


def test_rebuild_hook_runs_when_the_tree_is_built() -> None:
    ui, ctx = _ui()
    handle = ui.page(ctx, "notes", "笔记")
    state = {"n": 0}

    def rebuild() -> Page:
        state["n"] += 1
        return Page(Column(Text(f"第 {state['n']} 版")))

    handle.rebuild(rebuild)

    assert "第 1 版" in _texts(ui, "notes")
    assert "第 2 版" in _texts(ui, "notes")
    assert state["n"] == 2

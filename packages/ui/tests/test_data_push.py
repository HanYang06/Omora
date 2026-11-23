"""页面数据源：push_data 的 revision、整树快照与事件回包合并。

数据走 data op（纯数据、不动结构）；整树回退 / 重连时 base.data 必须带同一份快照，
否则客户端一重连就丢数据。事件回调里交的数据要搭这次事件的车回去，不单独推帧。
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import pytest

from omora.core.context import Context
from omora.core.kernel import Kernel
from omora.sdk.ui import Button, Column, Page, Text
from omora.ui import PageHandle, Ui, UiPlugin

ITEM = {"id": "a", "title": "甲"}


class _PagePlugin:
    def __init__(self, build: Callable[[], Page], page: str = "main", name: str = "viewer") -> None:
        self.name = name
        self._build = build
        self._page = page
        self.handle: PageHandle | None = None

    def apply(self, ctx: Context) -> None:
        ui: Ui = ctx.resolve("ui")
        self.handle = ui.page(ctx, self._page, "页面", self._build)


def _capture(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, Any]]:
    frames: list[dict[str, Any]] = []
    monkeypatch.setattr(
        "omora.ui.emit", lambda _ctx, _topic, payload, **_kw: frames.append(payload)
    )
    return frames


def _simple() -> Page:
    return Page(content=Column(Text("空")))


def _find_click(node: dict[str, Any]) -> str | None:
    handler = node.get("on", {}).get("click")
    if isinstance(handler, str):
        return handler
    for child in node["layout"]:
        found = _find_click(child)
        if found is not None:
            return found
    return None


def _mounted(
    monkeypatch: pytest.MonkeyPatch, build: Callable[[], Page] = _simple
) -> tuple[Ui, _PagePlugin, list[dict[str, Any]]]:
    frames = _capture(monkeypatch)
    kernel = Kernel()
    kernel.install(UiPlugin())
    plugin = _PagePlugin(build)
    kernel.install(plugin)
    ui: Ui = kernel.resolve("ui")
    ui.tree()
    assert plugin.handle is not None
    return ui, plugin, frames


def test_push_data_on_active_page_emits_one_data_op(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """active 页交数据：立即一帧 ops，里面只有那条 data op，版本涨 1。"""
    _ui, plugin, frames = _mounted(monkeypatch)
    assert plugin.handle is not None

    plugin.handle.data("ideas.feed", items=[ITEM])

    assert len(frames) == 1
    payload = frames[0]
    assert payload["kind"] == "ops"
    assert payload["document"] == payload["base"] + 1
    assert payload["ops"] == [
        {"op": "data", "source": "ideas.feed", "revision": 1, "items": [ITEM]}
    ]


def test_each_source_has_its_own_revision(monkeypatch: pytest.MonkeyPatch) -> None:
    """revision 按 source 各涨各的：同一份数据重发也要涨，客户端靠它判幂等。"""
    _ui, plugin, frames = _mounted(monkeypatch)
    assert plugin.handle is not None

    plugin.handle.data("ideas.feed", items=[ITEM])
    plugin.handle.data("ideas.feed", items=[ITEM])
    plugin.handle.data("ideas.count", value=1)

    revisions = [frame["ops"][0]["revision"] for frame in frames]
    sources = [frame["ops"][0]["source"] for frame in frames]
    assert revisions == [1, 2, 1]
    assert sources == ["ideas.feed", "ideas.feed", "ideas.count"]


def test_full_tree_carries_the_data_snapshot(monkeypatch: pytest.MonkeyPatch) -> None:
    """重连 / 整树回退要拿回同样的数据，不能只剩一个空 data。"""
    ui, plugin, _frames = _mounted(monkeypatch)
    assert plugin.handle is not None
    plugin.handle.data("ideas.feed", items=[ITEM])

    payload = ui.tree()

    assert payload["base"]["data"] == {
        "ideas.feed": {"revision": 1, "items": [ITEM]},
    }


def test_data_pushed_inside_event_rides_the_event_reply(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """事件回调里交的数据跟着这次事件的 ops 回去；不额外推一帧。"""
    holder: list[PageHandle] = []

    def click(_payload: dict[str, Any]) -> None:
        holder[0].data("ideas.count", value=2)

    def build() -> Page:
        return Page(content=Column(Button("加", on_click=click), Text("x")))

    frames = _capture(monkeypatch)
    kernel = Kernel()
    kernel.install(UiPlugin())
    plugin = _PagePlugin(build)
    kernel.install(plugin)
    ui: Ui = kernel.resolve("ui")
    assert plugin.handle is not None
    holder.append(plugin.handle)
    tree = ui.tree()
    handler = _find_click(tree["partials"][-1]["root"])
    assert handler is not None

    reply = ui.tree_event(handler, {})

    assert frames == []
    assert reply["kind"] == "ops"
    assert {"op": "data", "source": "ideas.count", "revision": 1, "value": 2} in reply["ops"]


def test_push_data_needs_exactly_one_payload(monkeypatch: pytest.MonkeyPatch) -> None:
    """value 与 items 只能给一个；两个都给要当场报错，不猜。"""
    _ui, plugin, frames = _mounted(monkeypatch)
    assert plugin.handle is not None

    with pytest.raises(ValueError, match="只能有"):
        plugin.handle.data("ideas.feed", value=1, items=[ITEM])

    assert frames == []


def test_data_for_inactive_page_waits_for_next_tree(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """没在看这一页时只记快照：不推帧，下次拉这一页时数据已经在 base 里。"""
    frames = _capture(monkeypatch)
    kernel = Kernel()
    kernel.install(UiPlugin())
    first = _PagePlugin(_simple, page="a", name="viewer-a")
    second = _PagePlugin(_simple, page="b", name="viewer-b")
    kernel.install(first)
    kernel.install(second)
    ui: Ui = kernel.resolve("ui")
    ui.tree("a")
    assert second.handle is not None

    second.handle.data("ideas.feed", items=[ITEM])

    assert frames == []
    assert ui.tree("b")["base"]["data"] == {
        "ideas.feed": {"revision": 1, "items": [ITEM]},
    }

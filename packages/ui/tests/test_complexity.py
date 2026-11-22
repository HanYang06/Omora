"""事件路径的复杂度：ops 只带被改的节点，节点型页面的处理量不超线性。

这里不测时间（CI 会抖），测的是“一次事件处理了几个节点”。

节点型页面本来就有 N 个节点（结构就是 N 个节点），所以这条只钉 compose / diff
不超线性。数据驱动的页面（列表走 collection）的 O(k) 验收在
`packages/ideas/tests/test_complexity.py`：50 条和 500 条，页面树一样大。
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from omora.core.context import Context
from omora.core.kernel import Kernel
from omora.sdk.tree_meter import measuring
from omora.sdk.ui import Button, Column, Page, Text
from omora.ui import Ui, UiPlugin


class _PagePlugin:
    def __init__(self, build: Callable[[], Page]) -> None:
        self.name = "viewer"
        self._build = build

    def apply(self, ctx: Context) -> None:
        ui: Ui = ctx.resolve("ui")
        ui.page(ctx, "main", "首页", self._build)


def _find_click(node: dict[str, Any]) -> str | None:
    handler = node.get("on", {}).get("click")
    if isinstance(handler, str):
        return handler
    for child in node["layout"]:
        found = _find_click(child)
        if found is not None:
            return found
    return None


def _mount(count: int) -> tuple[Ui, str]:
    """挂一页：按钮 + count 条文本；点按钮只改第一条文本。"""
    state = {"first": "旧"}

    def click(_payload: dict[str, Any]) -> None:
        state["first"] = "新"

    def build() -> Page:
        items = [
            Text(text=state["first"] if index == 0 else f"item-{index}") for index in range(count)
        ]
        return Page(content=Column(Button("改", on_click=click), *items))

    kernel = Kernel()
    kernel.install(UiPlugin())
    kernel.install(_PagePlugin(build))
    ui: Ui = kernel.resolve("ui")
    tree = ui.tree()
    handler = _find_click(tree["partials"][-1]["root"])
    assert handler is not None
    return ui, handler


def test_single_node_change_sends_only_that_node() -> None:
    """改一个节点的文字，回包就只有那一个 setProps——协议层不该被整页污染。"""
    ui, handler = _mount(50)

    reply = ui.tree_event(handler, {})

    assert reply["kind"] == "ops"
    assert [op["op"] for op in reply["ops"]] == ["setProps"]
    assert reply["ops"][0]["props"] == {"text": "新"}


def test_event_node_work_stays_within_a_linear_budget() -> None:
    """棘轮：一次事件的节点处理量不得超过线性的上界（超线性回归会在这里失败）。"""
    for count in (100, 800):
        ui, handler = _mount(count)
        with measuring() as meter:
            ui.tree_event(handler, {})

        assert meter.total <= 14 * count, f"{count} 条文本处理了 {meter.total} 个节点"

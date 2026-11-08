from collections.abc import Callable

import pytest

from core.context import Context
from core.kernel import Kernel
from packages.ui import Ui, UiPlugin
from sdk.ui import Button, Column, Node, Row, Text


class _ViewPlugin:
    def __init__(
        self, build: Callable[[], Node], view: str = "main", name: str = "viewer"
    ) -> None:
        self.name = name
        self._build = build
        self._view = view

    def apply(self, ctx: Context) -> None:
        ui: Ui = ctx.resolve("ui")
        ui.view(ctx, self._view, self._build)


def _screen() -> Column:
    return Column(
        Text("收件箱", kind="title"),
        Row(Text("买牛奶"), Button("归档", on_click=lambda: None)),
    )


def test_render_turns_a_node_tree_into_plain_data() -> None:
    kernel = Kernel()
    kernel.install(UiPlugin())
    kernel.install(_ViewPlugin(_screen))

    nodes = kernel.resolve("ui").render("main")

    assert nodes[0]["type"] == "column"
    assert nodes[0]["props"] == {}
    title, row = nodes[0]["children"]
    assert title == {"type": "text", "props": {"text": "收件箱", "kind": "title"}, "children": []}
    assert row["type"] == "row"
    assert row["children"][1]["props"]["text"] == "归档"


def test_a_callback_becomes_a_handler_id_and_fires() -> None:
    clicks: list[str] = []

    def screen() -> Column:
        return Column(Button("归档", on_click=lambda: clicks.append("clicked")))

    kernel = Kernel()
    kernel.install(UiPlugin())
    kernel.install(_ViewPlugin(screen))
    ui: Ui = kernel.resolve("ui")

    nodes = ui.render("main")
    handler = nodes[0]["children"][0]["props"]["on_click"]
    ui.event(handler, {})

    assert clicks == ["clicked"]


def test_event_returns_a_redrawn_tree() -> None:
    state = {"n": 0}

    def bump() -> None:
        state["n"] += 1

    def screen() -> Column:
        return Column(Button(str(state["n"]), on_click=bump))

    kernel = Kernel()
    kernel.install(UiPlugin())
    kernel.install(_ViewPlugin(screen))
    ui: Ui = kernel.resolve("ui")

    before = ui.render("main")
    handler = before[0]["children"][0]["props"]["on_click"]
    after = ui.event(handler, {})

    assert before[0]["children"][0]["props"]["text"] == "0"
    assert after[0]["children"][0]["props"]["text"] == "1"


def test_uninstalling_takes_the_view_away() -> None:
    kernel = Kernel()
    kernel.install(UiPlugin())
    kernel.install(_ViewPlugin(_screen))
    ui: Ui = kernel.resolve("ui")

    kernel.uninstall("viewer")

    with pytest.raises(LookupError, match="未知视图: main"):
        ui.render("main")


def test_registering_the_same_view_twice_is_rejected() -> None:
    kernel = Kernel()
    kernel.install(UiPlugin())
    kernel.install(_ViewPlugin(_screen))

    with pytest.raises(ValueError, match="视图重复登记: main"):
        kernel.install(_ViewPlugin(_screen, name="viewer2"))


def test_unknown_handler_is_looked_up() -> None:
    kernel = Kernel()
    kernel.install(UiPlugin())
    kernel.install(_ViewPlugin(_screen))

    with pytest.raises(LookupError, match="未知 handler: main:1:9"):
        kernel.resolve("ui").event("main:1:9", {})

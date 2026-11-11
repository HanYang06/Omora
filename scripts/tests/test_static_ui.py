"""启动骨架：摘回调、清数据、收页、出模块。"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import static_ui

from omora.core.kernel import Kernel
from omora.sdk.ui import Button, Column, Page, Text
from omora.ui import UiPlugin


def _body(text: str) -> Callable[[], Page]:
    def build() -> Page:
        return Page(Column(Text(text), Button("按一下")))

    return build


class _Pages:
    def __init__(self, names: tuple[str, ...]) -> None:
        self.name = "pages"
        self._names = names

    def apply(self, ctx: Any) -> None:
        ui = ctx.resolve("ui")
        for name in self._names:
            ui.page(ctx, name, name, _body(name))


def _kernel(*names: str) -> Kernel:
    kernel = Kernel()
    kernel.install(UiPlugin())
    kernel.install(_Pages(names))
    return kernel


def test_handlers_are_stripped_from_every_node() -> None:
    tree = {
        "type": "button",
        "props": {"text": "按一下", "on_click": "pages:1:0"},
        "children": [
            {"type": "text", "props": {"text": "字", "on_submit": "pages:1:1"}, "children": []}
        ],
    }

    stripped = static_ui.strip_handlers(tree)

    assert stripped["props"] == {"text": "按一下"}
    assert stripped["children"][0]["props"] == {"text": "字"}


def test_collect_follows_the_navigation_order() -> None:
    snapshots = static_ui.collect(_kernel("ideas", "projects"))

    assert list(snapshots) == ["ideas", "projects"]
    assert snapshots["ideas"]["meta"] == ""
    assert snapshots["ideas"]["page"] == "ideas"


def test_render_module_pins_names_hash_and_snapshots() -> None:
    snapshots = static_ui.collect(_kernel("ideas"))

    module = static_ui.render_module(snapshots)

    assert static_ui.hash_of(snapshots) in module
    assert '"ideas"' in module
    assert "export const STATIC_SNAPSHOTS" in module


def test_the_hash_changes_when_the_pages_change() -> None:
    one = static_ui.collect(_kernel("ideas"))
    two = static_ui.collect(_kernel("ideas", "projects"))

    assert static_ui.hash_of(one) != static_ui.hash_of(two)


def test_the_real_system_plugins_render_without_callbacks() -> None:
    snapshots = static_ui.build_snapshots()

    assert next(iter(snapshots)) == "ideas"
    for snapshot in snapshots.values():
        assert snapshot["meta"] == ""
        assert "on_click" not in str(snapshot["content"])

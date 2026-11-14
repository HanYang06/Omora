"""启动骨架：摘事件、收页、出模块（Slot 视图版）。"""

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


def _walk(slot: dict[str, Any]) -> list[dict[str, Any]]:
    found = [slot]
    for child in slot.get("children") or []:
        found.extend(_walk(child))
    for template in (slot.get("collection") or {}).get("templates", {}).values():
        found.extend(_walk(template))
    return found


def _events_of(view: dict[str, Any]) -> list[tuple[str, dict[str, Any]]]:
    return [
        (str(slot.get("kind")), slot["events"])
        for tree in view["localTrees"]["trees"]
        for slot in _walk(tree["root"])
        if slot.get("events")
    ]


def test_events_are_stripped_except_page_link() -> None:
    slot = {
        "id": "page.ideas.content.0",
        "kind": "dendro:button",
        "owner": "pages",
        "props": {"text": "按一下"},
        "events": {"click": "pages:1:0"},
        "children": [
            {
                "id": "page.ideas.content.0.0",
                "kind": "dendro:text",
                "owner": "pages",
                "props": {"text": "字"},
                "events": {"submit": "pages:1:1"},
                "children": [],
            }
        ],
    }
    nav = {
        "id": "ui.nav.ideas",
        "kind": "dendro:page-link",
        "owner": "ui",
        "props": {"label": "灵感"},
        "events": {"click": "slot:1:0"},
        "children": [],
    }

    stripped = static_ui.strip_events(slot)
    kept = static_ui.strip_events(nav)

    assert "events" not in stripped
    assert "events" not in stripped["children"][0]
    assert kept["events"] == {"click": "slot:1:0"}


def test_collect_follows_the_navigation_order_and_normalizes_version() -> None:
    views = static_ui.collect(_kernel("ideas", "projects"))

    assert list(views) == ["ideas", "projects"]
    for view in views.values():
        assert (view["kind"], view["schema"], view["version"]) == ("view", "dendro.ui/1", 1)
        assert view["localTrees"]["seq"] == 1
        assert "events" not in str(
            [slot for kind, slot in _events_of(view) if kind != "dendro:page-link"]
        )
        assert view["active"].startswith("page.")


def test_render_module_pins_names_hash_and_views() -> None:
    views = static_ui.collect(_kernel("ideas"))

    module = static_ui.render_module(views)

    assert static_ui.hash_of(views) in module
    assert '"ideas"' in module
    assert "export const STATIC_VIEWS" in module


def test_the_hash_changes_when_the_pages_change() -> None:
    one = static_ui.collect(_kernel("ideas"))
    two = static_ui.collect(_kernel("ideas", "projects"))

    assert static_ui.hash_of(one) != static_ui.hash_of(two)


def test_the_real_system_plugins_render_without_content_events() -> None:
    views = static_ui.build_views()

    assert next(iter(views)) == "ideas"
    for view in views.values():
        assert view["kind"] == "view"
        for kind, _events in _events_of(view):
            assert kind == "dendro:page-link", kind

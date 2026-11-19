"""页面登记、V1 树构建与事件派发：Ui 的生命周期行为。"""

from __future__ import annotations

import logging
from collections.abc import Callable
from typing import Any, cast

import pytest

from omora.core.context import Context
from omora.core.kernel import Kernel
from omora.core.log import Log
from omora.sdk.tree_build import compose
from omora.sdk.ui import Button, Column, Empty, Page, Text
from omora.ui import Ui, UiPlugin


class _PagePlugin:
    def __init__(
        self,
        build: Callable[[], Page] | None,
        page: str = "main",
        label: str = "首页",
        name: str = "viewer",
        icon: str | None = None,
    ) -> None:
        self.name = name
        self._build = build
        self._page = page
        self._label = label
        self._icon = icon

    def apply(self, ctx: Context) -> None:
        ui: Ui = ctx.resolve("ui")
        ui.page(ctx, self._page, self._label, self._build, icon=self._icon)


def _simple() -> Page:
    return Page(content=Empty("空"))


def _document(ui: Ui, page: str | None = None) -> dict[str, Any]:
    payload = ui.tree() if page is None else ui.tree(page)
    return compose(payload["base"], payload["partials"])


def _walk(node: dict[str, Any]) -> list[dict[str, Any]]:
    found = [node]
    for child in node["layout"]:
        found.extend(_walk(child))
    return found


def _nodes(node: dict[str, Any], kind: str) -> list[dict[str, Any]]:
    return [child for child in _walk(node) if child["kind"] == kind]


def _tree_handler(node: dict[str, Any], event: str = "click") -> str | None:
    handler = cast(dict[str, str], node.get("on", {})).get(event)
    if handler is not None:
        return handler
    for child in cast(list[dict[str, Any]], node.get("layout", [])):
        found = _tree_handler(child, event)
        if found is not None:
            return found
    return None


def test_tree_returns_base_and_partials_for_compose() -> None:
    kernel = Kernel()
    kernel.install(UiPlugin())
    kernel.install(_PagePlugin(_simple, label="首页"))
    ui: Ui = kernel.resolve("ui")

    payload = ui.tree()

    assert payload["kind"] == "tree"
    assert payload["name"] == "main"
    assert payload["base"]["schema"] == "dendro.tree/1"
    page_id = payload["base"]["pages"][0]["id"]
    assert payload["base"]["active"] == page_id
    assert [partial["source"] for partial in payload["partials"]] == ["ui", "viewer"]
    content = payload["partials"][-1]["root"]
    assert content["kind"] == "empty"
    assert content["settings"]["title"] == "空"


def test_tree_rejects_unknown_page() -> None:
    kernel = Kernel()
    kernel.install(UiPlugin())
    kernel.install(_PagePlugin(_simple, label="首页"))
    ui: Ui = kernel.resolve("ui")

    with pytest.raises(LookupError):
        ui.tree("nope")


def test_tree_without_pages_says_so() -> None:
    kernel = Kernel()
    kernel.install(UiPlugin())
    ui: Ui = kernel.resolve("ui")

    with pytest.raises(LookupError, match="没有登记任何页面"):
        ui.tree()


def test_tree_registers_handlers_and_dispatches() -> None:
    seen: list[dict[str, Any]] = []
    state = {"n": 0}

    def bump(payload: dict[str, Any]) -> None:
        state["n"] += 1
        seen.append(payload)

    def build() -> Page:
        return Page(content=Column(Button(str(state["n"]), on_click=bump)))

    kernel = Kernel()
    kernel.install(UiPlugin())
    kernel.install(_PagePlugin(build))
    ui: Ui = kernel.resolve("ui")

    tree = ui.tree()
    content = cast(dict[str, Any], tree["partials"][-1]["root"])
    handler = _tree_handler(content)
    assert handler is not None

    frame = ui.tree_event(handler, {"value": 1})

    assert state["n"] == 1
    assert seen == [{"value": 1}]
    assert frame["kind"] == "ops"
    assert (frame["base"], frame["document"]) == (1, 2)
    assert [op["op"] for op in frame["ops"]] == ["setProps"]
    assert frame["ops"][0]["props"]["text"] == "1"

    next_tree = ui.tree()
    next_content = cast(dict[str, Any], next_tree["partials"][-1]["root"])
    assert next_content["layout"][0]["settings"]["text"] == "1"
    assert _tree_handler(next_content) == handler

    ui.tree_event(handler, {})
    assert state["n"] == 2


def test_tree_nav_handlers_switch_page() -> None:
    kernel = Kernel()
    kernel.install(UiPlugin())
    kernel.install(_PagePlugin(_simple, page="main", label="首页", name="a"))
    kernel.install(_PagePlugin(_simple, page="other", label="其他", name="b"))
    ui: Ui = kernel.resolve("ui")

    tree = ui.tree()
    navs = [partial for partial in tree["partials"] if partial["source"] == "ui"]
    assert len(navs) == 2
    other = next(partial for partial in navs if partial["root"]["settings"]["label"] == "其他")
    assert other["root"]["settings"]["active"] is False
    handler = other["root"]["on"]["click"]

    frame = ui.tree_event(handler)

    assert frame["kind"] == "ops"
    kinds = [op["op"] for op in frame["ops"]]
    assert "unmount" in kinds
    assert "mount" in kinds
    assert "setProps" in kinds

    next_tree = ui.tree()
    assert next_tree["name"] == "other"
    next_navs = [partial for partial in next_tree["partials"] if partial["source"] == "ui"]
    other_next = next(
        partial for partial in next_navs if partial["root"]["settings"]["label"] == "其他"
    )
    assert other_next["root"]["settings"]["active"] is True


def test_tree_event_rejects_unknown_handler() -> None:
    kernel = Kernel()
    kernel.install(UiPlugin())
    kernel.install(_PagePlugin(_simple, label="首页"))
    ui: Ui = kernel.resolve("ui")
    ui.tree()

    with pytest.raises(LookupError):
        ui.tree_event("tree:404", {})


def test_pages_lists_registration_order_and_owner() -> None:
    kernel = Kernel()
    kernel.install(UiPlugin())
    kernel.install(_PagePlugin(_simple, page="a", label="甲", name="pa", icon="ideas"))
    kernel.install(_PagePlugin(_simple, page="b", label="乙", name="pb"))
    ui: Ui = kernel.resolve("ui")

    pages = ui.pages()

    assert [(page.name, page.label, page.owner) for page in pages] == [
        ("a", "甲", "pa"),
        ("b", "乙", "pb"),
    ]
    assert pages[0].icon == "ideas"
    assert ui.active_page is None


def test_tree_on_a_page_sets_active_and_falls_back_after_removal() -> None:
    kernel = Kernel()
    kernel.install(UiPlugin())
    kernel.install(_PagePlugin(_simple, page="a", label="甲", name="pa"))
    kernel.install(_PagePlugin(_simple, page="b", label="乙", name="pb"))
    ui: Ui = kernel.resolve("ui")

    ui.tree("b")
    assert ui.active_page == "b"

    kernel.uninstall("pb")
    assert ui.active_page is None
    assert ui.tree()["name"] == "a"


def _removable_page(state: dict[str, Any], seen: list[dict[str, Any]]) -> Callable[[], Page]:
    def page() -> Page:
        if state["open"] is False:
            return Page(content=Column(Text("已收起")))
        return Page(content=Column(Button("提交", on_click=seen.append)))

    return page


def test_previous_generation_handler_still_fires_once() -> None:
    """组件卸载时提交带的 id 属于上一代：重画之后还得能触发一次，不然那条就丢了。"""
    seen: list[dict[str, Any]] = []
    state: dict[str, Any] = {"open": True}
    kernel = Kernel()
    kernel.install(UiPlugin())
    kernel.install(_PagePlugin(_removable_page(state, seen)))
    ui: Ui = kernel.resolve("ui")

    old = _tree_handler(cast(dict[str, Any], ui.tree()["partials"][-1]["root"]))
    assert old is not None
    state["open"] = False
    ui.tree()

    ui.tree_event(old, {"value": "买牛奶"})

    assert seen == [{"value": "买牛奶"}]

    ui.tree()
    with pytest.raises(LookupError, match="未知 handler"):
        ui.tree_event(old, {"value": "又一条"})
    assert seen == [{"value": "买牛奶"}]


def test_a_stale_generation_event_is_logged(caplog: pytest.LogCaptureFixture) -> None:
    """陈旧 id 命中要说出来，别静默——它意味着有个回调在重画之后才回来。"""
    seen: list[dict[str, Any]] = []
    state: dict[str, Any] = {"open": True}
    caplog.set_level(logging.INFO)
    logger = logging.getLogger("omora.test.ui.tree.stale")
    kernel = Kernel(log=Log(logger, "ui", "kernel", logging.INFO))
    kernel.install(UiPlugin())
    kernel.install(_PagePlugin(_removable_page(state, seen)))
    ui: Ui = kernel.resolve("ui")

    old = _tree_handler(cast(dict[str, Any], ui.tree()["partials"][-1]["root"]))
    assert old is not None
    state["open"] = False
    ui.tree()
    ui.tree_event(old, {"value": "买牛奶"})

    stale = [record for record in caplog.records if record.getMessage() == "tree.event.stale"]
    assert len(stale) == 1
    assert vars(stale[0])["data"] == {"handler": old, "page": "main"}

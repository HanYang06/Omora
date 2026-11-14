"""整份 view 的更新：事件之后交回来的新视图反映树的变化（Slot 全量替换语义）。"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any, cast

from omora.core.context import Context
from omora.core.kernel import Kernel
from omora.sdk.ui import Button, Column, Item, List, Page, Row, Text
from omora.ui import Ui, UiPlugin

PAGE_MOUNT_AT = "dendro.window.page"


class _PagePlugin:
    def __init__(self, name: str, build: Callable[[], Page], *, page: str | None = None) -> None:
        self.name = name
        self._build = build
        self._page = page or name

    def apply(self, ctx: Context) -> None:
        ui: Ui = ctx.resolve("ui")
        ui.page(ctx, self._page, self._page, self._build)


def _walk(slot: dict[str, Any]) -> list[dict[str, Any]]:
    found = [slot]
    for child in slot["children"]:
        found.extend(_walk(child))
    return found


def _page_root(view: dict[str, Any]) -> dict[str, Any]:
    for tree in cast(list[dict[str, Any]], view["localTrees"]["trees"]):
        if tree["mountAt"] == PAGE_MOUNT_AT:
            return cast(dict[str, Any], tree["root"])
    raise AssertionError("view 里没有页面局部树")


def _content(view: dict[str, Any]) -> dict[str, Any]:
    return cast(dict[str, Any], _page_root(view)["children"][0])


def _slots(view: dict[str, Any], kind: str) -> list[dict[str, Any]]:
    return [slot for slot in _walk(_page_root(view)) if slot["kind"] == f"dendro:{kind}"]


def _handler(view: dict[str, Any], event: str) -> str:
    return str(_slots(view, "button")[0]["events"][event])


def _ui(build: Callable[[], Page], *, page: str = "ideas") -> Ui:
    kernel = Kernel()
    kernel.install(UiPlugin())
    kernel.install(_PagePlugin(page, build))
    ui: Ui = kernel.resolve("ui")
    return ui


def test_event_adds_a_node_to_the_view() -> None:
    state: dict[str, Any] = {"items": ["买牛奶"]}

    def add(_payload: dict[str, Any]) -> None:
        state["items"].append("写周报")

    def build() -> Page:
        return Page(
            content=Column(
                Button("加一条", on_click=add),
                List(*[Item(title) for title in state["items"]]),
            )
        )

    ui = _ui(build)
    view = ui.render()

    after = ui.event(_handler(view, "click"), {})

    assert [item["props"]["title"] for item in _slots(after, "item")] == ["买牛奶", "写周报"]


def test_event_removes_a_node_from_the_view() -> None:
    state: dict[str, Any] = {"items": ["买牛奶", "写周报"]}

    def drop(_payload: dict[str, Any]) -> None:
        state["items"].pop()

    def build() -> Page:
        return Page(
            content=Column(
                Button("删一条", on_click=drop),
                List(*[Item(title) for title in state["items"]]),
            )
        )

    ui = _ui(build)
    view = ui.render()

    after = ui.event(_handler(view, "click"), {})

    assert [item["props"]["title"] for item in _slots(after, "item")] == ["买牛奶"]


def test_event_updates_a_prop_in_the_view() -> None:
    state: dict[str, Any] = {"title": "旧标题"}

    def rename(_payload: dict[str, Any]) -> None:
        state["title"] = "新标题"

    def build() -> Page:
        return Page(content=Column(Text(state["title"]), Button("改名", on_click=rename)))

    ui = _ui(build)
    view = ui.render()
    assert _slots(view, "text")[0]["props"]["text"] == "旧标题"

    after = ui.event(_handler(view, "click"), {})

    assert _slots(after, "text")[0]["props"]["text"] == "新标题"


def test_event_can_change_the_content_root_kind() -> None:
    state: dict[str, Any] = {"wide": False}

    def widen(_payload: dict[str, Any]) -> None:
        state["wide"] = True

    def build() -> Page:
        inner = Button("换个排法", on_click=widen)
        return Page(content=Row(inner) if state["wide"] else Column(inner))

    ui = _ui(build)
    view = ui.render()
    assert _content(view)["kind"] == "dendro:column"

    after = ui.event(_handler(view, "click"), {})

    assert _content(after)["kind"] == "dendro:row"


def test_every_event_advances_the_view_version() -> None:
    def build() -> Page:
        return Page(content=Column(Button("刷新", on_click=lambda payload: None)))

    ui = _ui(build)
    view = ui.render()
    handler = _handler(view, "click")

    first = ui.event(handler, {})
    second = ui.event(handler, {})

    assert (view["version"], first["version"], second["version"]) == (1, 2, 3)


def test_nav_click_switches_the_page_tree_and_active() -> None:
    ideas = _PagePlugin("ideas", lambda: Page(content=Column(Text("灵感"))))
    projects = _PagePlugin("projects", lambda: Page(content=Column(Text("项目"))))
    kernel = Kernel()
    kernel.install(UiPlugin())
    kernel.install(ideas)
    kernel.install(projects)
    ui: Ui = kernel.resolve("ui")
    view = ui.render()
    nav = next(
        tree["root"]
        for tree in view["localTrees"]["trees"]
        if tree["mountAt"] == "dendro.window.nav"
    )
    click = nav["children"][1]["events"]["click"]

    after = ui.event(click, {})

    assert after["active"] == "page.projects"
    assert _page_root(after)["id"] == "page.projects"
    assert [slot["props"]["text"] for slot in _slots(after, "text")] == ["项目"]


def test_refresh_advances_the_version_and_keeps_the_tree() -> None:
    net_calls: list[dict[str, Any]] = []

    class _Net:
        name = "net"

        def apply(self, ctx: Context) -> None:
            ctx.provide("net", self)

        def emit(self, topic: str, payload: dict[str, Any], *, coalesce: bool = False) -> None:
            net_calls.append(payload)

    kernel = Kernel()
    kernel.install(UiPlugin())
    kernel.install(_Net())
    kernel.install(_PagePlugin("ideas", lambda: Page(content=Column(Text("稳定")))))
    ui: Ui = kernel.resolve("ui")
    ui.render()

    ui.refresh_page("ideas")
    ui.refresh_page("ideas")

    assert [payload["version"] for payload in net_calls] == [2, 3]
    assert all(payload["kind"] == "view" for payload in net_calls)
    assert _slots(net_calls[-1], "text")[0]["props"]["text"] == "稳定"


def test_view_seq_and_version_move_together() -> None:
    def build() -> Page:
        return Page(content=Column(Button("刷新", on_click=lambda payload: None)))

    ui = _ui(build)
    view = ui.render()
    after = ui.event(_handler(view, "click"), {})

    assert view["localTrees"]["seq"] == view["version"]
    assert after["localTrees"]["seq"] == after["version"]


def test_event_re_evaluates_the_build_callback() -> None:
    state = {"n": 0}

    def bump(_payload: dict[str, Any]) -> None:
        state["n"] += 1

    def build() -> Page:
        return Page(content=Column(Button(f"第 {state['n']} 次", on_click=bump)))

    ui = _ui(build)
    view = ui.render()

    after = ui.event(_handler(view, "click"), {})

    assert _slots(after, "button")[0]["props"]["text"] == "第 1 次"

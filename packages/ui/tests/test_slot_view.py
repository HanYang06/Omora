"""主会话 Slot 视图出口（S6.2）：ui.render / ui.event 在 engine="slot" 时交 view。"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any, cast

import pytest

from omora.core.context import Context
from omora.core.kernel import Kernel
from omora.sdk.ui import Button, Column, Page, Text
from omora.ui import PageHandle, Ui, UiPlugin


class _Net:
    """net 的替身：只记录推出去的东西，不解释。"""

    name = "net"

    def __init__(self) -> None:
        self.sent: list[tuple[str, dict[str, Any]]] = []

    def apply(self, ctx: Context) -> None:
        ctx.provide("net", self)

    def emit(self, topic: str, payload: dict[str, Any], *, coalesce: bool = False) -> None:
        self.sent.append((topic, payload))


class _PagePlugin:
    """登记一页的插件；owner 就是插件名。"""

    def __init__(
        self,
        name: str,
        page: str,
        label: str,
        build: Callable[[], Page] | None,
        *,
        icon: str | None = None,
    ) -> None:
        self.name = name
        self._page = page
        self._label = label
        self._build = build
        self._icon = icon
        self.handle: PageHandle | None = None

    def apply(self, ctx: Context) -> None:
        ui: Ui = ctx.resolve("ui")
        self.handle = ui.page(ctx, self._page, self._label, self._build, icon=self._icon)


def _noop(_payload: dict[str, Any]) -> None:
    pass


def _ideas_page() -> Page:
    return Page(content=Column(Text("灵感"), Button("刷新", on_click=_noop)), meta="1 条")


def _projects_page() -> Page:
    return Page(content=Column(Text("项目")))


def _kernel(
    *,
    net: _Net | None = None,
    ideas: _PagePlugin | None = None,
    projects: _PagePlugin | None = None,
) -> Kernel:
    kernel = Kernel()
    kernel.install(UiPlugin())
    if net is not None:
        kernel.install(net)
    kernel.install(
        ideas
        if ideas is not None
        else _PagePlugin("ideas", "ideas", "灵感", _ideas_page, icon="ideas")
    )
    kernel.install(
        projects
        if projects is not None
        else _PagePlugin("projects", "projects", "项目", _projects_page, icon="projects")
    )
    return kernel


def _ui(
    *,
    net: _Net | None = None,
    ideas: _PagePlugin | None = None,
    projects: _PagePlugin | None = None,
) -> Ui:
    ui: Ui = _kernel(net=net, ideas=ideas, projects=projects).resolve("ui")
    return ui


def _walk(node: dict[str, Any]) -> list[dict[str, Any]]:
    found = [node]
    for child in node["children"]:
        found.extend(_walk(child))
    return found


def _tree(view: dict[str, Any], mount_at: str) -> dict[str, Any]:
    for tree in cast(list[dict[str, Any]], view["localTrees"]["trees"]):
        if tree["mountAt"] == mount_at:
            return tree
    raise AssertionError(f"view 里没有挂在 {mount_at} 的局部树")


def _by_kind(view: dict[str, Any], mount_at: str, kind: str) -> dict[str, Any]:
    for node in _walk(_tree(view, mount_at)["root"]):
        if node["kind"] == kind:
            return node
    raise AssertionError(f"{mount_at} 下没有 {kind}")


def test_render_slot_produces_two_local_trees_and_the_page_table() -> None:
    view = _ui().render(engine="slot")

    assert (view["kind"], view["schema"], view["version"]) == ("view", "dendro.ui/1", 1)
    assert view["data"] == {}
    assert view["active"] == "page.ideas"
    assert [tree["mountAt"] for tree in view["localTrees"]["trees"]] == [
        "dendro.window.nav",
        "dendro.window.page",
    ]

    nav = _tree(view, "dendro.window.nav")
    assert (nav["owner"], nav["root"]["id"], nav["root"]["kind"], nav["root"]["owner"]) == (
        "ui",
        "ui.nav",
        "dendro:slot",
        "ui",
    )
    links = nav["root"]["children"]
    assert [link["id"] for link in links] == ["ui.nav.ideas", "ui.nav.projects"]
    assert [link["kind"] for link in links] == ["dendro:page-link", "dendro:page-link"]
    assert [(link["props"]["label"], link["props"]["icon"]) for link in links] == [
        ("灵感", "ideas"),
        ("项目", "projects"),
    ]
    assert links[0]["props"]["active"] is True
    assert "active" not in links[1]["props"]
    assert all(link["events"]["click"] for link in links)

    page = _tree(view, "dendro.window.page")
    assert (page["owner"], page["root"]["id"], page["root"]["kind"]) == (
        "ideas",
        "page.ideas",
        "dendro:page",
    )
    assert _by_kind(view, "dendro.window.page", "dendro:button")["props"]["text"] == "刷新"

    assert view["pages"] == [
        {"id": "page.ideas", "label": "灵感", "route": "/ideas", "owner": "ideas", "icon": "ideas"},
        {
            "id": "page.projects",
            "label": "项目",
            "route": "/projects",
            "owner": "projects",
            "icon": "projects",
        },
    ]
    assert view["localTrees"]["seq"] == 1


def test_render_slot_bumps_version_and_remembers_the_current_page() -> None:
    ui = _ui()

    assert ui.render(engine="slot")["version"] == 1
    assert ui.render(engine="slot")["version"] == 2

    switched = ui.render("projects", engine="slot")
    assert switched["version"] == 3
    assert switched["active"] == "page.projects"
    assert _tree(switched, "dendro.window.page")["root"]["id"] == "page.projects"

    assert ui.render(engine="slot")["active"] == "page.projects"


def test_nav_click_switches_the_page_and_returns_the_new_view() -> None:
    ui = _ui()
    view = ui.render(engine="slot")
    click = _tree(view, "dendro.window.nav")["root"]["children"][1]["events"]["click"]

    after = ui.event(click, {}, engine="slot")

    assert after["version"] == 2
    assert after["active"] == "page.projects"
    assert _tree(after, "dendro.window.page")["root"]["id"] == "page.projects"
    assert [page["id"] for page in after["pages"]] == ["page.ideas", "page.projects"]
    after_links = _tree(after, "dendro.window.nav")["root"]["children"]
    assert "active" not in after_links[0]["props"]
    assert after_links[1]["props"]["active"] is True


def test_page_handler_dispatches_then_returns_a_fresh_view() -> None:
    state = {"n": 0}

    def bump(_payload: dict[str, Any]) -> None:
        state["n"] += 1

    def build() -> Page:
        return Page(content=Column(Button(f"刷新 {state['n']}", on_click=bump)))

    ui = _ui(ideas=_PagePlugin("ideas", "ideas", "灵感", build, icon="ideas"))
    before = ui.render(engine="slot")
    handler = _by_kind(before, "dendro.window.page", "dendro:button")["events"]["click"]

    after = ui.event(handler, {"value": "x"}, engine="slot")

    assert state["n"] == 1
    assert after["version"] == 2
    assert _by_kind(after, "dendro.window.page", "dendro:button")["props"]["text"] == "刷新 1"


def test_the_previous_view_handler_still_fires_once() -> None:
    """组件卸载时提交的事件带上一代 id：slot 出口也要留一次宽限。"""
    seen: list[dict[str, Any]] = []

    def build() -> Page:
        return Page(content=Column(Button("归档", on_click=seen.append)))

    ui = _ui(ideas=_PagePlugin("ideas", "ideas", "灵感", build, icon="ideas"))
    first = ui.render(engine="slot")
    old = _by_kind(first, "dendro.window.page", "dendro:button")["events"]["click"]
    ui.render(engine="slot")

    after = ui.event(old, {"value": "买牛奶"}, engine="slot")

    assert seen == [{"value": "买牛奶"}]
    assert after["version"] == 3


def test_slot_refresh_pushes_the_whole_view_instead_of_a_patch() -> None:
    net = _Net()
    ui = _ui(net=net)
    ui.render(engine="slot")

    ui.refresh_page("ideas")

    topic, payload = net.sent[-1]
    assert topic == "ui.snapshot"
    assert payload["kind"] == "view"
    assert payload["version"] == 2
    assert payload["active"] == "page.ideas"
    assert "ops" not in payload


def test_set_page_pushes_a_view_only_while_that_page_is_active() -> None:
    net = _Net()
    ideas = _PagePlugin("ideas", "ideas", "灵感", None, icon="ideas")
    projects = _PagePlugin("projects", "projects", "项目", None, icon="projects")
    ui = _ui(net=net, ideas=ideas, projects=projects)
    assert ideas.handle is not None
    assert projects.handle is not None
    ideas.handle.set(Page(content=Column(Text("初始内容"))))
    projects.handle.set(Page(content=Column(Text("项目内容"))))
    ui.render(engine="slot")
    assert net.sent == []

    ideas.handle.set(Page(content=Column(Text("新内容"))))

    topic, pushed = net.sent[-1]
    assert topic == "ui.snapshot"
    assert pushed["kind"] == "view"
    assert pushed["version"] == 2
    page = _tree(pushed, "dendro.window.page")
    texts = [node["props"]["text"] for node in _walk(page["root"]) if node["kind"] == "dendro:text"]
    assert "新内容" in texts

    projects.handle.set(Page(content=Column(Text("后台更新"))))

    assert len(net.sent) == 1


def test_unknown_slot_handler_is_looked_up() -> None:
    ui = _ui()
    ui.render(engine="slot")

    with pytest.raises(LookupError, match="未知 handler"):
        ui.event("nope:1:0", {}, engine="slot")


def test_unknown_page_is_reported_in_slot_mode() -> None:
    with pytest.raises(LookupError, match="未知页面: missing"):
        _ui().render("missing", engine="slot")


def test_slot_render_without_pages_is_an_error() -> None:
    kernel = Kernel()
    kernel.install(UiPlugin())

    with pytest.raises(LookupError, match="没有登记任何页面"):
        kernel.resolve("ui").render(engine="slot")


def test_uninstalling_the_active_page_falls_back_to_the_first_page() -> None:
    ideas = _PagePlugin("ideas", "ideas", "灵感", _ideas_page, icon="ideas")
    kernel = _kernel(ideas=ideas)
    ui: Ui = kernel.resolve("ui")
    assert ui.render(engine="slot")["active"] == "page.ideas"

    kernel.uninstall("ideas")

    fallback = ui.render(engine="slot")
    assert fallback["active"] == "page.projects"
    assert [page["id"] for page in fallback["pages"]] == ["page.projects"]


def test_without_engine_the_legacy_snapshot_is_still_served() -> None:
    ui = _ui()

    snapshot = ui.render()

    assert "kind" not in snapshot
    assert snapshot["page"] == "ideas"
    assert snapshot["version"] == 1
    handler = snapshot["content"]["children"][1]["props"]["on_click"]
    assert ui.event(handler, {}) == {}

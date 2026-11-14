"""主会话 Slot 视图：ui.render / ui.event 交 view，set_page / refresh_page 推 view。"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any, cast

import pytest

from omora.core.context import Context
from omora.core.kernel import Kernel
from omora.sdk.ui import Button, Column, Input, Page, Text
from omora.ui import PageHandle, Ui, UiPlugin

PAGE_MOUNT_AT = "dendro.window.page"


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


def _walk(slot: dict[str, Any]) -> list[dict[str, Any]]:
    found = [slot]
    for child in slot["children"]:
        found.extend(_walk(child))
    return found


def _tree(view: dict[str, Any], mount_at: str) -> dict[str, Any]:
    for tree in cast(list[dict[str, Any]], view["localTrees"]["trees"]):
        if tree["mountAt"] == mount_at:
            return tree
    raise AssertionError(f"view 里没有挂在 {mount_at} 的局部树")


def _page_root(view: dict[str, Any]) -> dict[str, Any]:
    return cast(dict[str, Any], _tree(view, PAGE_MOUNT_AT)["root"])


def _content(view: dict[str, Any]) -> dict[str, Any]:
    return cast(dict[str, Any], _page_root(view)["children"][0])


def _kind(slot: dict[str, Any]) -> str:
    return str(slot["kind"]).removeprefix("dendro:")


def _slots(node: dict[str, Any], kind: str) -> list[dict[str, Any]]:
    return [slot for slot in _walk(node) if _kind(slot) == kind]


def _texts(view: dict[str, Any]) -> list[str]:
    return [str(slot["props"]["text"]) for slot in _walk(_page_root(view)) if _kind(slot) == "text"]


def test_render_produces_two_local_trees_and_the_page_table() -> None:
    view = _ui().render()

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
    assert all(link["events"]["click"] for link in links)

    page = _tree(view, "dendro.window.page")
    assert (page["owner"], page["root"]["id"], page["root"]["kind"]) == (
        "ideas",
        "page.ideas",
        "dendro:page",
    )
    assert page["root"]["props"] == {"label": "灵感", "icon": "ideas"}
    assert _slots(_page_root(view), "button")[0]["props"]["text"] == "刷新"

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


def test_render_bumps_version_and_remembers_the_current_page() -> None:
    ui = _ui()

    assert ui.render()["version"] == 1
    assert ui.render()["version"] == 2

    switched = ui.render("projects")
    assert switched["version"] == 3
    assert switched["active"] == "page.projects"
    assert _page_root(switched)["id"] == "page.projects"

    assert ui.render()["active"] == "page.projects"
    assert ui.render()["localTrees"]["seq"] == 5


def test_nav_click_switches_the_page_and_marks_the_active_link() -> None:
    ui = _ui()
    view = ui.render()
    click = _tree(view, "dendro.window.nav")["root"]["children"][1]["events"]["click"]

    after = ui.event(click, {})

    assert after["version"] == 2
    assert after["active"] == "page.projects"
    assert _page_root(after)["id"] == "page.projects"
    links = _tree(after, "dendro.window.nav")["root"]["children"]
    assert "active" not in links[0]["props"]
    assert links[1]["props"]["active"] is True


def test_page_handler_dispatches_then_returns_a_fresh_view() -> None:
    state = {"n": 0}

    def bump(_payload: dict[str, Any]) -> None:
        state["n"] += 1

    def build() -> Page:
        return Page(content=Column(Button(f"刷新 {state['n']}", on_click=bump)))

    ui = _ui(ideas=_PagePlugin("ideas", "ideas", "灵感", build, icon="ideas"))
    before = ui.render()
    handler = _slots(_page_root(before), "button")[0]["events"]["click"]

    after = ui.event(handler, {"value": "x"})

    assert state["n"] == 1
    assert after["version"] == 2
    assert _slots(_page_root(after), "button")[0]["props"]["text"] == "刷新 1"


def test_a_handler_from_the_previous_view_still_fires_once() -> None:
    seen: list[dict[str, Any]] = []

    def build() -> Page:
        return Page(content=Column(Button("归档", on_click=seen.append)))

    ui = _ui(ideas=_PagePlugin("ideas", "ideas", "灵感", build, icon="ideas"))
    first = ui.render()
    old = _slots(_page_root(first), "button")[0]["events"]["click"]
    ui.render()

    after = ui.event(old, {"value": "买牛奶"})

    assert seen == [{"value": "买牛奶"}]
    assert after["version"] == 3


def test_refresh_pushes_the_current_view() -> None:
    net = _Net()
    ui = _ui(net=net)
    ui.render()

    ui.refresh_page("ideas")

    topic, payload = net.sent[-1]
    assert topic == "ui.snapshot"
    assert payload["kind"] == "view"
    assert payload["version"] == 2
    assert payload["active"] == "page.ideas"


def test_set_page_pushes_the_current_view() -> None:
    net = _Net()
    ideas = _PagePlugin("ideas", "ideas", "灵感", None, icon="ideas")
    ui = _ui(net=net, ideas=ideas)
    assert ideas.handle is not None
    ideas.handle.set(Page(content=Column(Text("初始内容"))))
    ui.render()
    assert net.sent == []

    ideas.handle.set(Page(content=Column(Text("新内容"))))

    topic, pushed = net.sent[-1]
    assert topic == "ui.snapshot"
    assert pushed["kind"] == "view"
    assert pushed["version"] == 2
    assert "新内容" in _texts(pushed)


def test_set_page_for_another_page_pushes_the_current_view() -> None:
    """set_page 一律推当前视图：客户端手里的版本总会被推着往前走。"""
    net = _Net()
    projects = _PagePlugin("projects", "projects", "项目", None, icon="projects")
    ui = _ui(net=net, projects=projects)
    assert projects.handle is not None
    projects.handle.set(Page(content=Column(Text("项目内容"))))
    ui.render()
    assert net.sent == []

    projects.handle.set(Page(content=Column(Text("后台更新"))))

    topic, pushed = net.sent[-1]
    assert topic == "ui.snapshot"
    assert pushed["kind"] == "view"
    assert pushed["active"] == "page.ideas"
    assert pushed["version"] == 2


def test_set_page_inside_an_event_does_not_push_twice() -> None:
    net = _Net()
    ideas = _PagePlugin("ideas", "ideas", "灵感", None, icon="ideas")
    ui = _ui(net=net, ideas=ideas)
    assert ideas.handle is not None
    handle = ideas.handle

    def click(_payload: dict[str, Any]) -> None:
        handle.set(Page(content=Column(Text("点过了"))))

    handle.set(Page(content=Column(Button("点", on_click=click))))
    view = ui.render()
    handler = _slots(_page_root(view), "button")[0]["events"]["click"]

    after = ui.event(handler, {})

    assert net.sent == []
    assert after["kind"] == "view"
    assert "点过了" in _texts(after)


def test_set_page_before_the_first_render_does_not_push() -> None:
    net = _Net()
    ideas = _PagePlugin("ideas", "ideas", "灵感", None, icon="ideas")
    _ui(net=net, ideas=ideas)
    assert ideas.handle is not None

    ideas.handle.set(Page(content=Column(Text("还没人看"))))

    assert net.sent == []


def test_event_returns_a_new_version_when_nothing_changes() -> None:
    def build() -> Page:
        return Page(content=Column(Button("按一下", on_click=_noop)))

    ui = _ui(ideas=_PagePlugin("ideas", "ideas", "灵感", build, icon="ideas"))
    view = ui.render()
    handler = _slots(_page_root(view), "button")[0]["events"]["click"]

    after = ui.event(handler, {})

    assert after["kind"] == "view"
    assert after["version"] == 2
    assert _slots(_page_root(after), "button")[0]["props"]["text"] == "按一下"


def test_unknown_handler_is_looked_up() -> None:
    ui = _ui()
    ui.render()

    with pytest.raises(LookupError, match="未知 handler"):
        ui.event("nope:1:0", {})


def test_unknown_page_is_reported() -> None:
    with pytest.raises(LookupError, match="未知页面: missing"):
        _ui().render("missing")


def test_render_without_pages_is_an_error() -> None:
    kernel = Kernel()
    kernel.install(UiPlugin())

    with pytest.raises(LookupError, match="没有登记任何页面"):
        kernel.resolve("ui").render()


def test_uninstalling_the_active_page_falls_back_to_the_first_page() -> None:
    ideas = _PagePlugin("ideas", "ideas", "灵感", _ideas_page, icon="ideas")
    kernel = _kernel(ideas=ideas)
    ui: Ui = kernel.resolve("ui")
    assert ui.render()["active"] == "page.ideas"

    kernel.uninstall("ideas")

    fallback = ui.render()
    assert fallback["active"] == "page.projects"
    assert [page["id"] for page in fallback["pages"]] == ["page.projects"]


def test_page_content_keeps_props_and_maps_callables_to_events() -> None:
    submitted: list[dict[str, Any]] = []

    def build() -> Page:
        return Page(
            content=Column(
                Input(placeholder="记一笔", on_submit=submitted.append),
                Button("归档", on_click=_noop, variant="ghost"),
            )
        )

    ui = _ui(ideas=_PagePlugin("ideas", "ideas", "灵感", build, icon="ideas"))
    view = ui.render()
    content = _content(view)

    assert [_kind(child) for child in content["children"]] == ["input", "button"]
    field, action = content["children"]
    assert field["props"] == {"placeholder": "记一笔"}
    assert set(field["events"]) == {"submit"}
    assert set(action["props"]) == {"text", "variant"}
    assert set(action["events"]) == {"click"}

    ui.event(field["events"]["submit"], {"value": "买牛奶"})
    assert submitted == [{"value": "买牛奶"}]


def test_pages_side_table_keeps_registration_order_owner_and_optional_icon() -> None:
    kernel = Kernel()
    kernel.install(UiPlugin())
    kernel.install(_PagePlugin("first", "a", "甲", _ideas_page, icon="star"))
    kernel.install(_PagePlugin("second", "b", "乙", _ideas_page))

    pages = kernel.resolve("ui").render()["pages"]

    assert [page["id"] for page in pages] == ["page.a", "page.b"]
    assert [(page["label"], page["route"], page["owner"]) for page in pages] == [
        ("甲", "/a", "first"),
        ("乙", "/b", "second"),
    ]
    assert pages[0]["icon"] == "star"
    assert "icon" not in pages[1]


def test_build_callback_is_used_for_every_view() -> None:
    state = {"n": 0}

    def build() -> Page:
        state["n"] += 1
        return Page(content=Column(Text(f"第 {state['n']} 次")))

    ui = _ui(ideas=_PagePlugin("ideas", "ideas", "灵感", build, icon="ideas"))

    assert "第 1 次" in _texts(ui.render())
    assert "第 2 次" in _texts(ui.render())


def test_rebuild_hook_runs_when_a_page_is_rendered() -> None:
    state = {"n": 0}

    def build() -> Page:
        return Page(content=Column(Text(f"重画 {state['n']}")))

    ideas = _PagePlugin("ideas", "ideas", "灵感", None, icon="ideas")
    ui = _ui(ideas=ideas)
    assert ideas.handle is not None
    ideas.handle.set(Page(content=Column(Text("初始"))))
    assert "初始" in _texts(ui.render())

    def rebuild() -> Page:
        state["n"] += 1
        return build()

    ideas.handle.rebuild(rebuild)

    assert "重画 1" in _texts(ui.render())


def test_engine_argument_is_gone() -> None:
    ui = _ui()
    render = cast(Any, ui.render)
    event = cast(Any, ui.event)

    with pytest.raises(TypeError, match="engine"):
        render(engine="slot")
    ui.render()
    with pytest.raises(TypeError, match="engine"):
        event("slot:1:0", {}, engine="slot")


def test_contribute_topics_and_the_patch_module_are_gone() -> None:
    ui = _ui()

    assert not hasattr(ui, "contribute")
    assert not hasattr(ui, "topics")
    with pytest.raises(ModuleNotFoundError):
        __import__("omora._diff")


def test_event_does_not_push_a_snapshot() -> None:
    """事件的变化搭 result 的车；ui.snapshot 只留给异步推送。"""
    net = _Net()
    ui = _ui(net=net)
    view = ui.render()
    handler = _slots(_page_root(view), "button")[0]["events"]["click"]

    ui.event(handler, {})

    assert net.sent == []

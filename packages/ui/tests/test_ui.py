"""页面登记与 handler 派发：Ui 的生命周期行为（对 Slot 视图断言）。"""

from __future__ import annotations

import inspect
import logging
from collections.abc import Callable
from typing import Any, cast

import pytest

from omora.core.context import Context
from omora.core.kernel import Kernel
from omora.core.log import Log
from omora.sdk.ui import Button, Column, Empty, Input, Item, List, Page, Text
from omora.ui import Ui, UiPlugin

PAGE_MOUNT_AT = "dendro.window.page"


class _PagePlugin:
    def __init__(
        self,
        build: Callable[[], Page] | None,
        page: str = "main",
        label: str = "首页",
        name: str = "viewer",
    ) -> None:
        self.name = name
        self._build = build
        self._page = page
        self._label = label

    def apply(self, ctx: Context) -> None:
        ui: Ui = ctx.resolve("ui")
        ui.page(ctx, self._page, self._label, self._build)


def _simple() -> Page:
    return Page(content=Empty("空"))


def _simple_kernel() -> Kernel:
    kernel = Kernel()
    kernel.install(UiPlugin())
    kernel.install(_PagePlugin(_simple))
    return kernel


def _page() -> Page:
    return Page(
        content=Column(
            Text("灵感", kind="title"),
            Input(placeholder="记一笔", on_submit=lambda payload: None),
            List(
                Item(
                    "买牛奶",
                    Button("归档", on_click=lambda payload: None, variant="ghost"),
                    meta="昨天",
                )
            ),
        ),
    )


def _page_root(view: dict[str, Any]) -> dict[str, Any]:
    for tree in cast(list[dict[str, Any]], view["localTrees"]["trees"]):
        if tree["mountAt"] == PAGE_MOUNT_AT:
            return cast(dict[str, Any], tree["root"])
    raise AssertionError("view 里没有页面局部树")


def _content(view: dict[str, Any]) -> dict[str, Any]:
    return cast(dict[str, Any], _page_root(view)["children"][0])


def _walk(slot: dict[str, Any]) -> list[dict[str, Any]]:
    found = [slot]
    for child in slot["children"]:
        found.extend(_walk(child))
    return found


def _slots(view: dict[str, Any], kind: str) -> list[dict[str, Any]]:
    return [slot for slot in _walk(_page_root(view)) if slot["kind"] == f"dendro:{kind}"]


def _handler(view: dict[str, Any], node_kind: str, event: str) -> str:
    return str(_slots(view, node_kind)[0]["events"][event])


def test_render_returns_the_page_view_content_tree() -> None:
    kernel = Kernel()
    kernel.install(UiPlugin())
    kernel.install(_PagePlugin(_page, label="灵感"))

    view: dict[str, Any] = kernel.resolve("ui").render()

    assert (view["kind"], view["version"], view["active"]) == ("view", 1, "page.main")
    content = _content(view)
    assert content["kind"] == "dendro:column"
    text, input_node, list_node = content["children"]
    assert text["props"] == {"text": "灵感", "kind": "title"}
    assert input_node["kind"] == "dendro:input"
    assert input_node["props"]["placeholder"] == "记一笔"
    assert list_node["kind"] == "dendro:list"
    item = list_node["children"][0]
    assert item["props"] == {"meta": "昨天", "title": "买牛奶"}
    action = item["children"][0]
    assert action["props"] == {"text": "归档", "variant": "ghost"}
    assert action["events"]["click"]


def test_a_handler_receives_the_payload() -> None:
    seen: list[dict[str, Any]] = []

    def build() -> Page:
        return Page(content=Column(Input(placeholder="记一笔", on_submit=seen.append)))

    kernel = Kernel()
    kernel.install(UiPlugin())
    kernel.install(_PagePlugin(build))
    ui: Ui = kernel.resolve("ui")
    view = ui.render()

    ui.event(_handler(view, "input", "submit"), {"value": "买牛奶"})

    assert seen == [{"value": "买牛奶"}]


def test_event_redraws_the_page_it_belongs_to() -> None:
    state = {"n": 0}

    def bump(_payload: dict[str, Any]) -> None:
        state["n"] += 1

    def build() -> Page:
        return Page(content=Column(Button(str(state["n"]), on_click=bump)))

    kernel = Kernel()
    kernel.install(UiPlugin())
    kernel.install(_PagePlugin(build))
    ui: Ui = kernel.resolve("ui")

    before = ui.render()
    after = ui.event(_handler(before, "button", "click"), {})

    assert _slots(before, "button")[0]["props"]["text"] == "0"
    assert _slots(after, "button")[0]["props"]["text"] == "1"


def test_pages_keep_registration_order_and_routes() -> None:
    kernel = Kernel()
    kernel.install(UiPlugin())
    kernel.install(_PagePlugin(_simple, page="a", label="甲", name="pa"))
    kernel.install(_PagePlugin(_simple, page="b", label="乙", name="pb"))

    pages = kernel.resolve("ui").render()["pages"]

    assert [page["id"] for page in pages] == ["page.a", "page.b"]
    assert [(page["label"], page["route"], page["owner"]) for page in pages] == [
        ("甲", "/a", "pa"),
        ("乙", "/b", "pb"),
    ]


def test_rendering_an_unknown_page_says_so() -> None:
    kernel = _simple_kernel()

    with pytest.raises(LookupError, match="未知页面: missing"):
        kernel.resolve("ui").render("missing")


def test_uninstalling_takes_the_page_away() -> None:
    kernel = _simple_kernel()

    kernel.uninstall("viewer")

    with pytest.raises(LookupError, match="未知页面: main"):
        kernel.resolve("ui").render("main")


def test_registering_the_same_page_twice_is_rejected() -> None:
    kernel = _simple_kernel()

    with pytest.raises(ValueError, match="页面重复登记: main"):
        kernel.install(_PagePlugin(_simple, name="viewer2"))


def test_unknown_handler_is_looked_up() -> None:
    kernel = _simple_kernel()
    kernel.resolve("ui").render()

    with pytest.raises(LookupError, match="未知 handler: main:1:9"):
        kernel.resolve("ui").event("main:1:9", {})


def _input_page(seen: list[dict[str, Any]]) -> Callable[[], Page]:
    def build() -> Page:
        return Page(content=Column(Input(placeholder="记一笔", on_submit=seen.append)))

    return build


def _input_kernel(seen: list[dict[str, Any]]) -> Kernel:
    kernel = Kernel()
    kernel.install(UiPlugin())
    kernel.install(_PagePlugin(_input_page(seen)))
    return kernel


def _input_handler(view: dict[str, Any]) -> str:
    return str(_content(view)["children"][0]["events"]["submit"])


def test_a_handler_from_the_previous_render_still_fires_once() -> None:
    """组件卸载时提交带的 id 属于上一代：重画之后还得能触发一次，不然那条就丢了。"""
    seen: list[dict[str, Any]] = []
    ui: Ui = _input_kernel(seen).resolve("ui")

    old = _input_handler(ui.render())
    ui.render()
    ui.event(old, {"value": "买牛奶"})

    assert seen == [{"value": "买牛奶"}]


def test_a_handler_stops_working_after_the_next_render() -> None:
    """宽限只留一代：再画两次，上一代就被替换掉，陈旧 id 彻底作废。"""
    seen: list[dict[str, Any]] = []
    ui: Ui = _input_kernel(seen).resolve("ui")

    old = _input_handler(ui.render())
    ui.render()
    ui.render()

    with pytest.raises(LookupError, match="未知 handler"):
        ui.event(old, {"value": "买牛奶"})

    assert seen == []


def test_a_stale_id_never_runs_the_handler_that_took_its_index() -> None:
    """回归：陈旧 id 不能被下一代同序号的另一个回调接住。"""
    seen: list[str] = []
    state = {"step": 0}

    def build() -> Page:
        label = "甲" if state["step"] == 0 else "乙"

        def step(_payload: dict[str, Any]) -> None:
            seen.append(label)
            state["step"] = 1

        return Page(content=Column(Button(label, on_click=step)))

    kernel = Kernel()
    kernel.install(UiPlugin())
    kernel.install(_PagePlugin(build))
    ui: Ui = kernel.resolve("ui")

    old = str(_content(ui.render())["children"][0]["events"]["click"])
    ui.event(old, {})
    ui.event(old, {})

    assert seen == ["甲", "甲"]


def test_a_stale_event_is_logged(caplog: pytest.LogCaptureFixture) -> None:
    """陈旧 id 命中要说出来，别静默——它意味着有个回调在重画之后才回来。"""
    seen: list[dict[str, Any]] = []
    caplog.set_level(logging.INFO)
    logger = logging.getLogger("omora.test.ui.stale")
    kernel = Kernel(log=Log(logger, "ui", "kernel", logging.INFO))
    kernel.install(UiPlugin())
    kernel.install(_PagePlugin(_input_page(seen)))
    ui: Ui = kernel.resolve("ui")

    old = _input_handler(ui.render())
    ui.render()
    ui.event(old, {"value": "买牛奶"})

    stale = [record for record in caplog.records if record.getMessage() == "ui.event.stale"]
    assert len(stale) == 1
    assert vars(stale[0])["data"] == {"handler": old, "page": "main"}


def test_each_render_bumps_the_view_version() -> None:
    ui: Ui = _simple_kernel().resolve("ui")

    assert ui.render()["version"] == 1
    assert ui.render()["version"] == 2


def test_versions_are_monotonic_across_pages() -> None:
    kernel = Kernel()
    kernel.install(UiPlugin())
    kernel.install(_PagePlugin(_simple, page="a", label="甲", name="pa"))
    kernel.install(_PagePlugin(_simple, page="b", label="乙", name="pb"))
    ui: Ui = kernel.resolve("ui")

    assert ui.render("a")["version"] == 1
    assert ui.render("a")["version"] == 2
    assert ui.render("b")["version"] == 3


def test_rendering_a_page_without_a_tree_is_an_error() -> None:
    kernel = Kernel()
    kernel.install(UiPlugin())
    kernel.install(_PagePlugin(None, page="notes", label="笔记"))

    with pytest.raises(LookupError, match="还没交树"):
        kernel.resolve("ui").render("notes")


def test_render_and_event_signatures_are_frozen() -> None:
    """engine 参数彻底删除：两个出口只收冻结的这几个字段。"""
    assert list(inspect.signature(Ui.render).parameters) == ["self", "page"]
    assert list(inspect.signature(Ui.event).parameters) == ["self", "handler", "payload"]


def test_event_returns_a_view_not_an_empty_confirmation() -> None:
    def build() -> Page:
        return Page(content=Column(Button("按一下", on_click=lambda payload: None)))

    kernel = Kernel()
    kernel.install(UiPlugin())
    kernel.install(_PagePlugin(build))
    ui: Ui = kernel.resolve("ui")
    view = ui.render()
    handler = str(_content(view)["children"][0]["events"]["click"])

    after = ui.event(handler, {})

    assert after["kind"] == "view"
    assert after["active"] == "page.main"
    assert after["version"] == view["version"] + 1

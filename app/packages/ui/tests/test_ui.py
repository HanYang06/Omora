import logging
from collections.abc import Callable
from typing import Any

import pytest

from omora.core.context import Context
from omora.core.kernel import Kernel
from omora.core.log import Log
from omora.sdk.ui import Button, Column, Empty, Input, Item, List, Page, Text
from omora.ui import Ui, UiPlugin


class _PagePlugin:
    def __init__(
        self,
        build: Callable[[], Page],
        page: str = "main",
        label: str = "首页",
        name: str = "viewer",
        count: Callable[[], int] | None = None,
    ) -> None:
        self.name = name
        self._build = build
        self._page = page
        self._label = label
        self._count = count

    def apply(self, ctx: Context) -> None:
        ui: Ui = ctx.resolve("ui")
        ui.page(ctx, self._page, self._label, self._build, self._count)


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
                    "昨天", "买牛奶", Button("归档", on_click=lambda payload: None, variant="ghost")
                )
            ),
        ),
        meta="1 条",
    )


def test_render_returns_the_page_snapshot() -> None:
    kernel = Kernel()
    kernel.install(UiPlugin())
    kernel.install(_PagePlugin(_page, label="灵感"))

    snapshot: dict[str, Any] = kernel.resolve("ui").render()

    assert snapshot["pages"] == [{"name": "main", "label": "灵感"}]
    assert snapshot["page"] == "main"
    assert snapshot["meta"] == "1 条"
    node = snapshot["content"]
    assert node["type"] == "column"
    text, input_node, list_node = node["children"]
    assert text["props"] == {"text": "灵感", "kind": "title"}
    assert input_node["type"] == "input"
    assert input_node["props"]["placeholder"] == "记一笔"
    assert list_node["type"] == "list"
    item = list_node["children"][0]
    assert item["props"] == {"meta": "昨天", "title": "买牛奶"}
    action = item["children"][0]
    assert action["props"]["text"] == "归档"
    assert action["props"]["variant"] == "ghost"


def test_a_handler_receives_the_payload() -> None:
    seen: list[dict[str, Any]] = []

    def build() -> Page:
        return Page(content=Column(Input(placeholder="记一笔", on_submit=seen.append)))

    kernel = Kernel()
    kernel.install(UiPlugin())
    kernel.install(_PagePlugin(build))
    ui: Ui = kernel.resolve("ui")

    handler = ui.render()["content"]["children"][0]["props"]["on_submit"]
    ui.event(handler, {"value": "买牛奶"})

    assert seen == [{"value": "买牛奶"}]


def test_event_redraws_the_page_it_belongs_to() -> None:
    state = {"n": 0}

    def bump(payload: dict[str, Any]) -> None:
        state["n"] += 1

    def build() -> Page:
        return Page(content=Column(Button(str(state["n"]), on_click=bump)))

    kernel = Kernel()
    kernel.install(UiPlugin())
    kernel.install(_PagePlugin(build))
    ui: Ui = kernel.resolve("ui")

    before = ui.render()
    handler = before["content"]["children"][0]["props"]["on_click"]
    after = ui.event(handler, {})

    assert before["content"]["children"][0]["props"]["text"] == "0"
    assert after["content"]["children"][0]["props"]["text"] == "1"


def test_pages_keep_registration_order_and_counts() -> None:
    kernel = Kernel()
    kernel.install(UiPlugin())
    kernel.install(_PagePlugin(_simple, page="a", label="甲", name="pa", count=lambda: 3))
    kernel.install(_PagePlugin(_simple, page="b", label="乙", name="pb"))

    snapshot = kernel.resolve("ui").render()

    assert [page["name"] for page in snapshot["pages"]] == ["a", "b"]
    assert snapshot["pages"][0]["count"] == 3
    assert "count" not in snapshot["pages"][1]
    assert snapshot["page"] == "a"


def test_rendering_an_unknown_page_says_so() -> None:
    kernel = _simple_kernel()

    with pytest.raises(LookupError, match="未知页面: missing"):
        kernel.resolve("ui").render("missing")


def test_rendering_with_no_pages_is_an_error() -> None:
    kernel = Kernel()
    kernel.install(UiPlugin())

    with pytest.raises(LookupError, match="没有登记任何页面"):
        kernel.resolve("ui").render()


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


def test_a_handler_from_the_previous_render_still_fires_once() -> None:
    """组件卸载时提交带的 id 属于上一代：重画之后还得能触发一次，不然那条就丢了。"""
    seen: list[dict[str, Any]] = []
    ui: Ui = _input_kernel(seen).resolve("ui")

    old = ui.render()["content"]["children"][0]["props"]["on_submit"]
    ui.render()
    ui.event(old, {"value": "买牛奶"})

    assert seen == [{"value": "买牛奶"}]


def test_a_handler_stops_working_after_the_next_render() -> None:
    """宽限只留一代：再画一次，上一代就被替换掉，陈旧 id 彻底作废。"""
    seen: list[dict[str, Any]] = []
    ui: Ui = _input_kernel(seen).resolve("ui")

    old = ui.render()["content"]["children"][0]["props"]["on_submit"]
    ui.render()
    ui.render()

    with pytest.raises(LookupError, match="未知 handler"):
        ui.event(old, {"value": "买牛奶"})

    assert seen == []


def test_a_stale_id_never_runs_the_handler_that_took_its_index() -> None:
    """回归：id 曾按 generation + 序号回收，重画后同序号的另一个回调会被陈旧 id 打到。"""
    seen: list[str] = []
    state = {"step": 0}

    def build() -> Page:
        label = "甲" if state["step"] == 0 else "乙"

        def step(payload: dict[str, Any]) -> None:
            seen.append(label)
            state["step"] = 1

        return Page(content=Column(Button(label, on_click=step)))

    kernel = Kernel()
    kernel.install(UiPlugin())
    kernel.install(_PagePlugin(build))
    ui: Ui = kernel.resolve("ui")

    old = ui.render()["content"]["children"][0]["props"]["on_click"]
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

    old = ui.render()["content"]["children"][0]["props"]["on_submit"]
    ui.render()
    ui.event(old, {"value": "买牛奶"})

    stale = [record for record in caplog.records if record.getMessage() == "ui.event.stale"]
    assert len(stale) == 1
    assert vars(stale[0])["data"] == {"handler": old, "page": "main"}

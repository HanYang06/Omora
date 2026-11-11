"""视图增量：事件引起的视图变化走 ui.snapshot（协议 §6.1）。

这里钉的是发出去的东西：能 diff 就带 {page, version, base, ops}，
不能 diff（换页 / 形状换了）就带全量快照（含 version）；视图没变就不发。
"""

from typing import Any

from omora._diff import diff_snapshot
from omora.core.context import Context
from omora.core.kernel import Kernel
from omora.sdk.ui import Button, Column, Input, Item, List, Page, Row, Text
from omora.ui import Ui, UiPlugin


class _Net:
    """net 的替身：只记录推出去的东西，不解释。"""

    name = "net"

    def __init__(self) -> None:
        self.sent: list[tuple[str, dict[str, Any]]] = []

    def apply(self, ctx: Context) -> None:
        ctx.provide("net", self)

    def emit(self, topic: str, payload: dict[str, Any], *, coalesce: bool = False) -> None:
        self.sent.append((topic, payload))


class _Viewer:
    name = "viewer"

    def __init__(
        self, build: Any, page: str = "main", label: str = "首页", name: str = "viewer"
    ) -> None:
        self._build = build
        self._page = page
        self._label = label
        self.name = name

    def apply(self, ctx: Context) -> None:
        ui: Ui = ctx.resolve("ui")
        ui.page(ctx, self._page, self._label, self._build)


def _kernel(build: Any, net: _Net, **viewer: Any) -> Kernel:
    kernel = Kernel()
    kernel.install(UiPlugin())
    kernel.install(net)
    kernel.install(_Viewer(build, **viewer))
    return kernel


def _last(net: _Net) -> dict[str, Any]:
    topic, payload = net.sent[-1]
    assert topic == "ui.snapshot"
    return payload


def test_adding_an_item_pushes_an_insert_with_the_new_version_and_base() -> None:
    state: dict[str, Any] = {"items": ["买牛奶"]}

    def add(payload: dict[str, Any]) -> None:
        state["items"].append("写周报")

    def build() -> Page:
        return Page(
            content=Column(
                Button("加一条", on_click=add),
                List(*[Item(title, meta="昨天") for title in state["items"]]),
            ),
            meta=f"{len(state['items'])} 条",
        )

    net = _Net()
    ui: Ui = _kernel(build, net).resolve("ui")
    first = ui.render()

    assert ui.event(str(first["content"]["children"][0]["props"]["on_click"]), {}) == {}

    payload = _last(net)
    assert payload["page"] == "main"
    assert (payload["base"], payload["version"]) == (1, 2)
    assert payload["ops"] == [
        {"op": "set", "path": ["meta"], "value": "2 条"},
        {
            "op": "set",
            "path": ["content", "children", 0, "props", "on_click"],
            "value": "main:2:0",
        },
        {
            "op": "insert",
            "path": ["content", "children", 1, "children"],
            "index": 1,
            "value": {"type": "item", "props": {"meta": "昨天", "title": "写周报"}, "children": []},
        },
    ]


def test_removing_an_item_pushes_a_remove_op() -> None:
    state: dict[str, Any] = {"items": ["买牛奶", "写周报"]}

    def drop(payload: dict[str, Any]) -> None:
        state["items"].pop()

    def build() -> Page:
        return Page(
            content=Column(
                Button("删一条", on_click=drop),
                List(*[Item(title, meta="昨天") for title in state["items"]]),
            ),
            meta=f"{len(state['items'])} 条",
        )

    net = _Net()
    ui: Ui = _kernel(build, net).resolve("ui")
    first = ui.render()

    ui.event(str(first["content"]["children"][0]["props"]["on_click"]), {})

    payload = _last(net)
    assert (payload["base"], payload["version"]) == (1, 2)
    assert payload["ops"] == [
        {"op": "set", "path": ["meta"], "value": "1 条"},
        {
            "op": "set",
            "path": ["content", "children", 0, "props", "on_click"],
            "value": "main:2:0",
        },
        {"op": "remove", "path": ["content", "children", 1, "children"], "index": 1},
    ]


def test_changing_a_field_pushes_a_set_for_that_field() -> None:
    state: dict[str, Any] = {"title": "旧标题"}

    def rename(payload: dict[str, Any]) -> None:
        state["title"] = "新标题"

    def build() -> Page:
        return Page(content=Column(Text(state["title"]), Button("改名", on_click=rename)))

    net = _Net()
    ui: Ui = _kernel(build, net).resolve("ui")
    first = ui.render()

    ui.event(str(first["content"]["children"][1]["props"]["on_click"]), {})

    payload = _last(net)
    assert (payload["base"], payload["version"]) == (1, 2)
    assert payload["ops"] == [
        {"op": "set", "path": ["content", "children", 0, "props", "text"], "value": "新标题"},
        {
            "op": "set",
            "path": ["content", "children", 1, "props", "on_click"],
            "value": "main:2:0",
        },
    ]


def test_an_event_on_another_page_pushes_a_full_snapshot_then_patches_it() -> None:
    """换页时客户端手里不是这一页，服务端补不了：推全量；之后回到补丁。"""
    net = _Net()
    kernel = Kernel()
    kernel.install(UiPlugin())
    kernel.install(net)
    kernel.install(_Viewer(_button_page, page="a", label="甲", name="viewer-a"))
    kernel.install(_Viewer(_button_page, page="b", label="乙", name="viewer-b"))
    ui: Ui = kernel.resolve("ui")

    other = ui.render("b")
    ui.render("a")

    ui.event(str(other["content"]["children"][0]["props"]["on_click"]), {})

    full = _last(net)
    assert full["page"] == "b"
    assert "ops" not in full
    assert full["version"] == 2
    assert full["content"]["children"][0]["props"]["on_click"] == "b:2:0"

    ui.event(str(full["content"]["children"][0]["props"]["on_click"]), {})

    patch = _last(net)
    assert (patch["base"], patch["version"]) == (2, 3)
    assert patch["ops"] == [
        {"op": "set", "path": ["content", "children", 0, "props", "on_click"], "value": "b:3:0"}
    ]


def _button_page() -> Page:
    return Page(content=Column(Button("刷新", on_click=lambda payload: None)))


def test_a_root_shape_change_is_one_set_for_the_whole_content() -> None:
    """根节点类型变了也能表达：整棵 content 一个 set，不需要退成全量。"""
    state: dict[str, Any] = {"wide": False}

    def widen(payload: dict[str, Any]) -> None:
        state["wide"] = True

    def build() -> Page:
        inner = Button("换个排法", on_click=widen)
        return Page(content=Row(inner) if state["wide"] else Column(inner))

    net = _Net()
    ui: Ui = _kernel(build, net).resolve("ui")
    first = ui.render()

    ui.event(str(first["content"]["children"][0]["props"]["on_click"]), {})

    patch = _last(net)
    assert (patch["base"], patch["version"]) == (1, 2)
    (op,) = patch["ops"]
    assert op["op"] == "set"
    assert op["path"] == ["content"]
    assert op["value"]["type"] == "row"
    assert op["value"]["children"][0]["props"]["on_click"] == "main:2:0"


def test_dropping_a_prop_replaces_that_node_and_nothing_else() -> None:
    """协议没有删字段的 op：只能整颗节点换掉；兄弟节点仍然原样。"""
    state: dict[str, Any] = {"filled": True}

    def clear(payload: dict[str, Any]) -> None:
        state["filled"] = False

    def build() -> Page:
        field = (
            Input(placeholder="记一笔", value="旧值", on_submit=clear)
            if state["filled"]
            else Input(placeholder="记一笔", on_submit=clear)
        )
        return Page(content=Column(Text("标题"), field))

    net = _Net()
    ui: Ui = _kernel(build, net).resolve("ui")
    first = ui.render()

    ui.event(str(first["content"]["children"][1]["props"]["on_submit"]), {})

    patch = _last(net)
    assert patch["ops"] == [
        {
            "op": "set",
            "path": ["content", "children", 1],
            "value": {
                "type": "input",
                "props": {"placeholder": "记一笔", "on_submit": "main:2:0"},
                "children": [],
            },
        }
    ]


def test_nothing_changes_so_nothing_is_pushed() -> None:
    """陈旧 handler 再触发一次，重画出来一模一样：不推、不动版本。"""
    state: dict[str, Any] = {"open": True}

    def close(payload: dict[str, Any]) -> None:
        state["open"] = False

    def build() -> Page:
        content = Button("收起", on_click=close) if state["open"] else Text("已收起")
        return Page(content=Column(content))

    net = _Net()
    ui: Ui = _kernel(build, net).resolve("ui")
    first = ui.render()
    closing = str(first["content"]["children"][0]["props"]["on_click"])

    ui.event(closing, {})
    assert len(net.sent) == 1

    ui.event(closing, {})

    assert len(net.sent) == 1
    assert ui.render()["version"] == 3


def test_two_pages_are_two_views_so_they_are_never_patched_together() -> None:
    base: dict[str, Any] = {"pages": [], "page": "a", "meta": "", "content": _leaf("甲")}

    assert diff_snapshot(base, {**base, "page": "b"}) is None


def _leaf(text: str) -> dict[str, Any]:
    return {"type": "text", "props": {"text": text}, "children": []}

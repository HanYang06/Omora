"""legacy Node / Page → Slot 局部树（S6.2）：id、kind、events 与页面根 header。"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from itertools import count
from typing import Any, ClassVar

import pytest

from omora.sdk.document import DocumentError, Slot
from omora.sdk.local_tree import LocalTree, serialize_local_trees
from omora.sdk.slot_tree import (
    NAV_MOUNT_AT,
    PAGE_MOUNT_AT,
    NavLink,
    page_id,
    serialize_nav_slot,
    serialize_page_slot,
)
from omora.sdk.ui import Button, Column, Hotkey, Input, Item, List, Node, Page, Row, Text

Handler = Callable[[dict[str, Any]], None]


def _noop(_payload: dict[str, Any]) -> None:
    pass


def _sequential() -> Callable[[Any], str]:
    counter = count()

    def register(_handler: Any) -> str:
        return f"h{next(counter)}"

    return register


def _page(content: Node | None = None, *, meta: str = "") -> Page:
    return Page(content=content if content is not None else Column(Text("内容")), meta=meta)


def _tree(
    content: Node | None = None,
    *,
    meta: str = "",
    label: str = "灵感",
    icon: str | None = "ideas",
    owner: str = "ideas",
    name: str = "ideas",
) -> LocalTree:
    return serialize_page_slot(
        _page(content, meta=meta),
        _sequential(),
        owner=owner,
        page_name=name,
        label=label,
        icon=icon,
    )


def _walk(slot: Slot) -> list[Slot]:
    found = [slot]
    for child in slot.children:
        found.extend(_walk(child))
    return found


def _by_id(tree: LocalTree, node_id: str) -> Slot:
    for slot in _walk(tree.root):
        if slot.id == node_id:
            return slot
    raise AssertionError(f"树里没有节点 {node_id}")


def _ids(tree: LocalTree) -> list[str]:
    return [slot.id for slot in _walk(tree.root)]


def _dict_walk(node: dict[str, Any]) -> list[dict[str, Any]]:
    found = [node]
    for child in node["children"]:
        found.extend(_dict_walk(child))
    return found


def test_page_root_is_a_deterministic_page_slot() -> None:
    tree = _tree(Column(Text("你好")), label="灵感", icon="ideas")

    assert (tree.owner, tree.mount_at) == ("ideas", PAGE_MOUNT_AT)
    root = tree.root
    assert (root.id, root.kind, root.owner) == (page_id("ideas"), "dendro:page", "ideas")
    assert root.layout is not None
    assert (root.layout.flow, root.layout.capacity) == ("column", "many")
    assert root.props == {"label": "灵感", "icon": "ideas"}


def test_legacy_types_get_the_dendro_namespace() -> None:
    tree = _tree(Column(Text("你好"), Button("按一下", on_click=_noop)))

    content = _by_id(tree, f"{page_id('ideas')}.content")

    assert content.kind == "dendro:column"
    assert [child.kind for child in content.children] == ["dendro:text", "dendro:button"]


def test_already_namespaced_types_are_kept() -> None:
    @dataclass(frozen=True)
    class Card(Node):
        type: ClassVar[str] = "ideas:card"
        title: str = ""

    card = _by_id(_tree(Card("买牛奶")), f"{page_id('ideas')}.content")

    assert card.kind == "ideas:card"
    assert card.props == {"title": "买牛奶"}


def test_callable_fields_become_events_and_never_stay_in_props() -> None:
    tree = _tree(
        Column(
            Button("归档", on_click=_noop),
            Input(placeholder="记一笔", on_submit=_noop),
            Hotkey(key="space", on_press=_noop, on_release=_noop),
        )
    )
    slots = _walk(tree.root)
    by_kind = {slot.kind: slot for slot in slots}

    assert by_kind["dendro:button"].events == {"click": _noop}
    assert by_kind["dendro:input"].events == {"submit": _noop}
    assert by_kind["dendro:hotkey"].events == {"press": _noop, "release": _noop}
    event_prop_names = {"on_click", "on_submit", "on_press", "on_release"}
    for slot in slots:
        assert not any(callable(value) for value in slot.props.values()), slot.id
        assert event_prop_names.isdisjoint(slot.props), slot.id


def test_event_handlers_are_serialized_through_the_register() -> None:
    tree = _tree(Column(Button("归档", on_click=_noop)))

    payload = serialize_local_trees([tree], _sequential())

    nodes = _dict_walk(payload["trees"][0]["root"])
    button = next(node for node in nodes if node["kind"] == "dendro:button")
    assert button["events"] == {"click": "h0"}
    assert "on_click" not in button["props"]


def test_ids_are_stable_when_the_same_tree_is_rebuilt() -> None:
    content = Column(
        Text("列表"),
        Row(Text("左"), Text("右")),
        List(Item("买牛奶", Button("归档", on_click=_noop), meta="昨天")),
    )

    first = _ids(_tree(content))
    second = _ids(_tree(content))

    assert first == second
    assert len(first) == len(set(first))


def test_nested_children_ids_follow_the_index_path() -> None:
    tree = _tree(Column(Row(Text("a"), Text("b")), Text("c")))

    assert _ids(tree) == [
        "page.ideas",
        "page.ideas.header",
        "page.ideas.header.title",
        "page.ideas.content",
        "page.ideas.content.0",
        "page.ideas.content.0.0",
        "page.ideas.content.0.1",
        "page.ideas.content.1",
    ]


def test_page_header_keeps_the_label_with_an_optional_meta() -> None:
    tree = _tree(Column(Text("内容")), label="灵感", meta="12 条")

    header = tree.root.children[0]
    assert (header.id, header.kind) == ("page.ideas.header", "dendro:row")
    assert header.layout is not None
    assert header.layout.flow == "row"
    assert [child.props for child in header.children] == [
        {"text": "灵感", "kind": "title"},
        {"text": "12 条", "kind": "meta"},
    ]

    plain = _tree(Column(Text("内容")), label="灵感")
    assert [child.id for child in plain.root.children[0].children] == ["page.ideas.header.title"]


def test_nav_tree_carries_page_links_and_click_handlers() -> None:
    picked: list[dict[str, Any]] = []

    def pick(payload: dict[str, Any]) -> None:
        picked.append(payload)

    tree = serialize_nav_slot(
        [
            NavLink("ideas", "灵感", "ideas", pick),
            NavLink("projects", "项目", None, _noop),
        ],
        _sequential(),
    )

    assert (tree.owner, tree.mount_at) == ("ui", NAV_MOUNT_AT)
    root = tree.root
    assert (root.id, root.kind, root.owner) == ("ui.nav", "dendro:slot", "ui")
    assert root.layout is not None
    assert (root.layout.flow, root.layout.capacity) == ("column", "many")
    assert [link.id for link in root.children] == ["ui.nav.ideas", "ui.nav.projects"]
    first, second = root.children
    assert first.kind == "dendro:page-link"
    assert first.props == {"label": "灵感", "icon": "ideas"}
    assert first.events == {"click": pick}
    assert second.props == {"label": "项目"}

    payload = serialize_local_trees([tree], _sequential())
    node = payload["trees"][0]["root"]["children"][0]
    assert node["events"] == {"click": "h0"}

    # 序列化结果只留 id，不留可调用对象。
    assert isinstance(node["events"]["click"], str)


def test_nav_and_page_ids_never_collide() -> None:
    nav = serialize_nav_slot([NavLink("ideas", "灵感", None, _noop)], _sequential())
    page = _tree(Column(Text("内容")))

    payload = serialize_local_trees([nav, page], _sequential())

    ids = [node["id"] for tree in payload["trees"] for node in _dict_walk(tree["root"])]
    assert len(ids) == len(set(ids))
    assert {"ui.nav", "ui.nav.ideas", "page.ideas", "page.ideas.content"} <= set(ids)


def test_duplicate_nav_pages_are_rejected() -> None:
    with pytest.raises(DocumentError, match="重复导航页面: ideas"):
        serialize_nav_slot(
            [NavLink("ideas", "灵感", None, _noop), NavLink("ideas", "再灵感", None, _noop)],
            _sequential(),
        )

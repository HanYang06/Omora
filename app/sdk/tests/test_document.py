"""v2 文档契约：Python 序列化必须与跨语言 fixture 完全一致。"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from omora.sdk.document import (
    Collection,
    Document,
    DocumentError,
    Grant,
    Input,
    Layout,
    PageEntry,
    Reaction,
    Slot,
)
from omora.sdk.document_io import serialize_document, serialize_slot

_FIXTURE = Path(__file__).resolve().parent / "fixtures" / "document.json"
_DATA: dict[str, Any] = json.loads(_FIXTURE.read_text(encoding="utf-8"))


def _noop(payload: dict[str, Any]) -> None:
    pass


def _register(_handler: Any) -> str:
    return "h0"


def _tree() -> Document:
    item_template = Slot(
        "tpl.ideas.item",
        "ideas:card",
        owner="ideas",
        binding={"title": "item.title", "meta": "item.meta"},
    )
    feed = Slot(
        "ideas.feed",
        "dendro:slot",
        owner="ideas",
        layout=Layout(flow="column", capacity="many"),
        collection=Collection(
            source="ideas.feed",
            key="id",
            templates={"item": item_template},
        ),
    )
    page = Slot("page.ideas", "dendro:page", owner="ideas", children=[feed])
    page_region = Slot(
        "dendro.window.page",
        "dendro:slot",
        owner="dendro",
        layout=Layout(flow="column", size={"width": "fill"}, capacity="one"),
        children=[page],
    )
    nav_link = Slot(
        "nav.ideas",
        "dendro:page-link",
        owner="ideas",
        props={"label": "灵感", "icon": "ideas"},
        events={"click": _noop},
        reactions=[
            Reaction(
                on={"event": "click"},
                do=[{"effect": "navigate", "page": "page.ideas"}],
            )
        ],
    )
    nav_region = Slot(
        "dendro.window.nav",
        "dendro:slot",
        owner="dendro",
        layout=Layout(flow="column", size={"width": 56}, capacity="many"),
        children=[nav_link],
    )
    root = Slot(
        "dendro.window",
        "dendro:window",
        owner="dendro",
        layout=Layout(flow="row", capacity="many"),
        children=[nav_region, page_region],
    )
    return Document(
        root,
        active="page.ideas",
        pages=[
            PageEntry("page.ideas", "灵感", route="/ideas", owner="ideas"),
        ],
        data={
            "ideas.feed": {
                "revision": 5,
                "items": [{"id": "42", "template": "item", "title": "买牛奶", "meta": "刚刚"}],
            }
        },
        version=3,
    )


def test_serialized_document_matches_the_shared_fixture() -> None:
    assert serialize_document(_tree(), _register) == _DATA


def test_slot_serializes_optional_flow_fields() -> None:
    slot = Slot(
        "ideas.search",
        "ideas:search",
        owner="ideas",
        scope="page.ideas",
        props={"placeholder": "搜索"},
        binding={"value": "search.query"},
        inputs=[Input(source="ideas.search", path="query")],
        grant=Grant(capabilities={"update": ["owner"], "observe": ["tier:system"]}),
    )

    node = serialize_slot(slot, _register)

    assert node["scope"] == "page.ideas"
    assert node["bind"] == {"value": "search.query"}
    assert node["in"] == [{"source": "ideas.search", "path": "query"}]
    assert node["grant"] == {"update": ["owner"], "observe": ["tier:system"]}


def test_duplicate_ids_are_rejected() -> None:
    document = Document(
        Slot(
            "same",
            "dendro:slot",
            owner="ideas",
            children=[Slot("same", "dendro:slot", owner="ideas")],
        ),
        active="",
    )

    with pytest.raises(DocumentError, match="重复 id: same"):
        serialize_document(document, _register)


def test_kind_must_be_namespaced() -> None:
    with pytest.raises(DocumentError, match="命名空间:名字"):
        serialize_slot(Slot("x", "column", owner="ideas"), _register)


def test_active_must_be_a_registered_page() -> None:
    document = Document(
        Slot("root", "dendro:slot", owner="dendro"),
        active="page.missing",
        pages=[PageEntry("page.ideas", "灵感", route="/ideas", owner="ideas")],
    )

    with pytest.raises(DocumentError, match="active 不在 pages 里"):
        serialize_document(document, _register)


def test_bad_layout_is_rejected_at_construction() -> None:
    with pytest.raises(DocumentError, match=r"layout\.flow"):
        Layout(flow="diagonal")

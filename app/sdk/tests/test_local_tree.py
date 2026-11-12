"""local-trees 线上形状：Python 序列化必须与跨语言 fixture 完全一致。"""

from __future__ import annotations

import json
import re
from collections.abc import Callable
from itertools import count
from pathlib import Path
from typing import Any, cast

import pytest

from omora.sdk.document import Collection, DocumentError, Input, Layout, Reaction, Slot
from omora.sdk.local_tree import LocalTree, serialize_local_trees

_FIXTURE = Path(__file__).resolve().parent / "fixtures" / "local-trees.json"
_DATA: dict[str, Any] = json.loads(_FIXTURE.read_text(encoding="utf-8"))


def _noop(_payload: dict[str, Any]) -> None:
    pass


def _sequential_register() -> Callable[[Any], str]:
    counter = count()

    def register(_handler: Any) -> str:
        return f"h{next(counter)}"

    return register


def _root(slot_id: str, *, owner: str = "ideas") -> Slot:
    return Slot(slot_id, "ideas:card", owner=owner)


def _fixture_trees() -> list[LocalTree]:
    search = Slot(
        "ideas.search",
        "dendro:search",
        owner="ideas",
        props={"placeholder": "搜索"},
        events={"query": _noop},
    )
    new = Slot(
        "ideas.new",
        "dendro:button",
        owner="ideas",
        props={"text": "新建", "variant": "primary"},
        events={"click": _noop},
        reactions=[
            Reaction(
                on={"event": "click"},
                do=[{"effect": "route", "page": "page.ideas"}],
            )
        ],
    )
    toolbar = Slot(
        "ideas.toolbar",
        "dendro:slot",
        owner="ideas",
        layout=Layout(flow="row", gap="sm", capacity="many"),
        children=[search, new],
    )
    feed = Slot(
        "ideas.feed",
        "dendro:slot",
        owner="ideas",
        layout=Layout(flow="column", capacity="many"),
        inputs=[Input(source="ideas.feed")],
    )
    page = Slot(
        "page.ideas",
        "dendro:page",
        owner="ideas",
        props={"label": "灵感", "icon": "ideas"},
        layout=Layout(flow="column", capacity="many"),
        children=[toolbar, feed],
    )
    nav = Slot(
        "nav.ideas",
        "dendro:page-link",
        owner="dendro",
        props={"label": "灵感", "icon": "ideas"},
        events={"click": _noop},
    )
    return [
        LocalTree("ideas", page, "dendro.window.page", order=10, seq=1),
        LocalTree("dendro", nav, "dendro.window.nav", order=10, seq=1),
        LocalTree(
            "ideas",
            Slot(
                "ideas.feed#42",
                "ideas:card",
                owner="ideas",
                props={"title": "买牛奶", "meta": "刚刚"},
            ),
            "ideas.feed",
            order=20,
            seq=2,
        ),
        LocalTree(
            "audio",
            Slot(
                "ideas.feed#7",
                "ideas:card",
                owner="audio",
                props={"title": "录音", "meta": "3 秒"},
            ),
            "ideas.feed",
            order=30,
            seq=1,
        ),
    ]


def test_serialized_local_trees_match_the_shared_fixture() -> None:
    assert serialize_local_trees(_fixture_trees(), _sequential_register(), seq=3) == _DATA


def test_slot_events_are_serialized_through_the_register() -> None:
    tree = LocalTree(
        "ideas",
        Slot("ideas.new", "dendro:button", owner="ideas", events={"click": _noop}),
        "ideas.feed",
    )

    node = serialize_local_trees([tree], _sequential_register())["trees"][0]

    assert node["root"]["events"] == {"click": "h0"}


def test_tree_envelope_always_carries_order_and_seq() -> None:
    tree = LocalTree("ideas", _root("ideas.feed#1"), "ideas.feed")

    node = serialize_local_trees([tree], _sequential_register())["trees"][0]

    assert (node["owner"], node["mountAt"], node["order"], node["seq"]) == (
        "ideas",
        "ideas.feed",
        0,
        0,
    )


def test_replace_is_emitted_only_when_true() -> None:
    replaced = LocalTree("ideas", _root("ideas.feed#1"), "ideas.feed", replace=True)
    plain = LocalTree("ideas", _root("ideas.feed#2"), "ideas.feed")

    nodes = serialize_local_trees([replaced, plain], _sequential_register())["trees"]

    assert nodes[0]["replace"] is True
    assert "replace" not in nodes[1]


def test_empty_trees_serialize_to_an_empty_payload() -> None:
    assert serialize_local_trees([], _sequential_register(), seq=0) == {
        "kind": "local-trees",
        "seq": 0,
        "trees": [],
    }


@pytest.mark.parametrize("bad_seq", [True, -1, cast(int, "3")])
def test_payload_seq_must_be_a_non_negative_int(bad_seq: int) -> None:
    with pytest.raises(DocumentError, match="seq"):
        serialize_local_trees([], _sequential_register(), seq=bad_seq)


def test_trees_must_be_a_sequence() -> None:
    not_trees: Any = "nope"

    with pytest.raises(DocumentError, match="trees 必须是序列"):
        serialize_local_trees(not_trees, _sequential_register())


def test_trees_must_contain_local_tree_instances() -> None:
    bad_trees: Any = [object()]

    with pytest.raises(DocumentError, match="trees 里只能是 LocalTree"):
        serialize_local_trees(bad_trees, _sequential_register())


def test_local_tree_owner_must_match_root_owner() -> None:
    with pytest.raises(DocumentError, match=r"local_tree.root.owner"):
        LocalTree("ideas", _root("ideas.card", owner="audio"), "ideas.feed")


@pytest.mark.parametrize(
    ("owner", "mount_at"),
    [(" ", "ideas.feed"), ("ideas", " "), ("", "ideas.feed"), ("ideas", "")],
)
def test_local_tree_identity_must_be_non_empty(owner: str, mount_at: str) -> None:
    with pytest.raises(DocumentError, match="非空字符串"):
        LocalTree(owner, _root("ideas.card"), mount_at)


def test_local_tree_root_must_be_a_slot() -> None:
    bad_root: Any = object()

    with pytest.raises(DocumentError, match=re.escape("local_tree.root 必须是 Slot")):
        LocalTree("ideas", bad_root, "ideas.feed")


@pytest.mark.parametrize("bad_order", [True, cast(int, "10")])
def test_local_tree_order_must_be_an_int(bad_order: int) -> None:
    with pytest.raises(DocumentError, match=r"local_tree.order"):
        LocalTree("ideas", _root("ideas.card"), "ideas.feed", order=bad_order)


@pytest.mark.parametrize("bad_seq", [False, cast(int, "1")])
def test_local_tree_seq_must_be_an_int(bad_seq: int) -> None:
    with pytest.raises(DocumentError, match=r"local_tree.seq"):
        LocalTree("ideas", _root("ideas.card"), "ideas.feed", seq=bad_seq)


def test_local_tree_replace_must_be_bool() -> None:
    with pytest.raises(DocumentError, match=r"local_tree.replace"):
        LocalTree("ideas", _root("ideas.card"), "ideas.feed", replace=cast(bool, 1))


def test_duplicate_ids_across_tree_roots_are_rejected() -> None:
    trees = [
        LocalTree("ideas", Slot("page.ideas", "dendro:page", owner="ideas"), "dendro.window.page"),
        LocalTree("audio", _root("page.ideas", owner="audio"), "ideas.feed"),
    ]

    with pytest.raises(DocumentError, match=re.escape("重复 id: page.ideas")):
        serialize_local_trees(trees, _sequential_register())


def test_duplicate_ids_between_root_and_nested_child_are_rejected() -> None:
    nested = Slot("ideas.search", "dendro:search", owner="ideas")
    toolbar = Slot("ideas.toolbar", "dendro:slot", owner="ideas", children=[nested])
    page = Slot("page.ideas", "dendro:page", owner="ideas", children=[toolbar])
    trees = [
        LocalTree("ideas", page, "dendro.window.page"),
        LocalTree("audio", _root("ideas.search", owner="audio"), "ideas.feed"),
    ]

    with pytest.raises(DocumentError, match=re.escape("重复 id: ideas.search")):
        serialize_local_trees(trees, _sequential_register())


def test_duplicate_ids_inside_collection_templates_are_rejected() -> None:
    template = Slot("ideas.card", "ideas:card", owner="ideas")
    feed = Slot(
        "ideas.feed",
        "dendro:slot",
        owner="ideas",
        collection=Collection(source="ideas.feed", key="id", templates={"item": template}),
    )
    page = Slot("page.ideas", "dendro:page", owner="ideas", children=[feed])
    trees = [
        LocalTree("ideas", page, "dendro.window.page"),
        LocalTree("audio", _root("ideas.card", owner="audio"), "ideas.feed"),
    ]

    with pytest.raises(DocumentError, match=re.escape("重复 id: ideas.card")):
        serialize_local_trees(trees, _sequential_register())


def test_non_slot_children_are_rejected_with_document_error() -> None:
    bad_children: Any = [object()]
    root = Slot("page.ideas", "dendro:page", owner="ideas", children=bad_children)

    with pytest.raises(DocumentError, match="children 只能是 Slot"):
        serialize_local_trees(
            [LocalTree("ideas", root, "dendro.window.page")], _sequential_register()
        )


def test_blank_slot_ids_are_reported_as_shape_errors_not_duplicates() -> None:
    root = Slot(" ", "ideas:card", owner="ideas")

    with pytest.raises(DocumentError, match=re.escape("slot.id 必须是非空字符串")):
        serialize_local_trees([LocalTree("ideas", root, "ideas.feed")], _sequential_register())

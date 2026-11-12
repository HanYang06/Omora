"""data 线上形状：Python 序列化必须与跨语言 fixture 完全一致。"""

from __future__ import annotations

import json
from collections.abc import Callable
from pathlib import Path
from typing import Any, cast

import pytest

from omora.sdk.data import (
    ChangesData,
    DataUpdate,
    ItemsData,
    ScalarData,
    serialize_data,
    serialize_data_updates,
)
from omora.sdk.document import DocumentError

_FIXTURE = Path(__file__).resolve().parent / "fixtures" / "data.json"
_DATA: list[dict[str, Any]] = json.loads(_FIXTURE.read_text(encoding="utf-8"))


def _fixture_updates() -> list[DataUpdate]:
    """与 fixture 逐字段相同的三条 update：标量、items 全量、changes 增量。"""
    return [
        ScalarData("net", "session.status", 1, {"connected": True}),
        ItemsData(
            "ideas",
            "ideas.feed",
            5,
            [
                {"id": "42", "template": "item", "title": "买牛奶"},
                {"id": "7", "template": "item", "title": "录音"},
            ],
        ),
        ChangesData(
            "ideas",
            "ideas.feed",
            6,
            [
                {
                    "kind": "insert",
                    "key": "43",
                    "at": 0,
                    "item": {"id": "43", "template": "item", "title": "新条目"},
                },
                {"kind": "update", "key": "42", "item": {"title": "买牛奶（改）"}},
                {"kind": "remove", "key": "7"},
                {"kind": "move", "key": "43", "at": 1},
            ],
        ),
    ]


def test_serialized_data_updates_match_the_shared_fixture() -> None:
    assert serialize_data_updates(_fixture_updates()) == _DATA


def test_scalar_update_serializes_to_value_only() -> None:
    payload = serialize_data(ScalarData("net", "session.status", 3, {"connected": False}))

    assert payload == {
        "kind": "data",
        "owner": "net",
        "source": "session.status",
        "revision": 3,
        "value": {"connected": False},
    }


def test_items_update_serializes_to_items_only() -> None:
    payload = serialize_data(ItemsData("ideas", "ideas.feed", 5, [{"id": "42", "title": "买牛奶"}]))

    assert payload == {
        "kind": "data",
        "owner": "ideas",
        "source": "ideas.feed",
        "revision": 5,
        "items": [{"id": "42", "title": "买牛奶"}],
    }


def test_changes_update_serializes_to_changes_only() -> None:
    payload = serialize_data(
        ChangesData("ideas", "ideas.feed", 6, [{"kind": "remove", "key": "7"}])
    )

    assert payload == {
        "kind": "data",
        "owner": "ideas",
        "source": "ideas.feed",
        "revision": 6,
        "changes": [{"kind": "remove", "key": "7"}],
    }


def test_scalar_value_may_be_null() -> None:
    payload = serialize_data(ScalarData("net", "session.status", 1, None))

    assert payload == {
        "kind": "data",
        "owner": "net",
        "source": "session.status",
        "revision": 1,
        "value": None,
    }


def test_empty_items_serialize_to_an_empty_array() -> None:
    payload = serialize_data(ItemsData("ideas", "ideas.feed", 0, []))

    assert payload == {
        "kind": "data",
        "owner": "ideas",
        "source": "ideas.feed",
        "revision": 0,
        "items": [],
    }


def test_empty_changes_serialize_to_an_empty_array() -> None:
    payload = serialize_data(ChangesData("ideas", "ideas.feed", 0, []))

    assert payload == {
        "kind": "data",
        "owner": "ideas",
        "source": "ideas.feed",
        "revision": 0,
        "changes": [],
    }


def test_updates_keep_their_declaration_order() -> None:
    updates: list[DataUpdate] = [
        ScalarData("net", "session.status", 9, {"connected": True}),
        ItemsData("ideas", "ideas.feed", 2, []),
        ChangesData("audio", "audio.level", 0, []),
    ]

    payloads = serialize_data_updates(updates)

    assert [(payload["source"], payload["revision"]) for payload in payloads] == [
        ("session.status", 9),
        ("ideas.feed", 2),
        ("audio.level", 0),
    ]


def test_no_updates_serialize_to_an_empty_array() -> None:
    assert serialize_data_updates([]) == []


def test_scalar_value_is_deep_copied_from_the_construction_input() -> None:
    value: dict[str, Any] = {"connected": True, "peers": [{"id": "a"}]}
    update = ScalarData("net", "session.status", 1, value)

    value["connected"] = False
    value["peers"][0]["id"] = "b"

    assert serialize_data(update)["value"] == {"connected": True, "peers": [{"id": "a"}]}


def test_items_are_deep_copied_from_the_construction_input() -> None:
    item: dict[str, Any] = {"id": "42", "meta": {"tags": ["a"]}}
    items = [item]
    update = ItemsData("ideas", "ideas.feed", 1, items)

    item["id"] = "changed"
    item["meta"]["tags"].append("b")
    items.append({"id": "99"})

    assert serialize_data(update)["items"] == [{"id": "42", "meta": {"tags": ["a"]}}]


def test_changes_are_deep_copied_from_the_construction_input() -> None:
    change: dict[str, Any] = {"kind": "update", "key": "42", "item": {"title": "a"}}
    changes = [change]
    update = ChangesData("ideas", "ideas.feed", 1, changes)

    change["item"]["title"] = "b"
    changes.clear()

    assert serialize_data(update)["changes"] == [
        {"kind": "update", "key": "42", "item": {"title": "a"}}
    ]


def test_serialized_payload_does_not_alias_stored_data() -> None:
    update = ItemsData("ideas", "ideas.feed", 1, [{"id": "42", "meta": {"x": 1}}])

    payload = serialize_data(update)
    payload["items"][0]["meta"]["x"] = 2
    payload["items"].clear()

    assert serialize_data(update)["items"] == [{"id": "42", "meta": {"x": 1}}]


_UPDATE_BUILDERS: list[Callable[[str, str], DataUpdate]] = [
    lambda owner, source: ScalarData(owner, source, 1, None),
    lambda owner, source: ItemsData(owner, source, 1, []),
    lambda owner, source: ChangesData(owner, source, 1, []),
]

_REVISION_BUILDERS: list[Callable[[int], DataUpdate]] = [
    lambda revision: ScalarData("net", "session.status", revision, None),
    lambda revision: ItemsData("ideas", "ideas.feed", revision, []),
    lambda revision: ChangesData("ideas", "ideas.feed", revision, []),
]


@pytest.mark.parametrize("build", _UPDATE_BUILDERS)
@pytest.mark.parametrize(
    ("owner", "source", "match"),
    [
        ("", "session.status", "data.owner"),
        (" ", "session.status", "data.owner"),
        ("net", "", "data.source"),
        ("net", " ", "data.source"),
    ],
)
def test_update_identity_must_be_non_empty(
    build: Callable[[str, str], DataUpdate], owner: str, source: str, match: str
) -> None:
    with pytest.raises(DocumentError, match=match):
        build(owner, source)


@pytest.mark.parametrize("build", _REVISION_BUILDERS)
@pytest.mark.parametrize("revision", [False, True, -1, cast(int, "1")])
def test_revision_must_be_a_non_negative_int(
    build: Callable[[int], DataUpdate], revision: int
) -> None:
    with pytest.raises(DocumentError, match=r"data\.revision"):
        build(revision)


@pytest.mark.parametrize("items", ["nope", {"id": "42"}, cast(Any, 42)])
def test_items_must_be_a_sequence(items: Any) -> None:
    with pytest.raises(DocumentError, match=r"data\.items 必须是序列"):
        ItemsData("ideas", "ideas.feed", 1, items)


@pytest.mark.parametrize("item", ["42", cast(Any, 42), ["id"]])
def test_each_item_must_be_an_object(item: Any) -> None:
    with pytest.raises(DocumentError, match=r"data\.items 的每一项必须是对象"):
        ItemsData("ideas", "ideas.feed", 1, [item])


@pytest.mark.parametrize("changes", ["nope", {"kind": "remove", "key": "7"}])
def test_changes_must_be_a_sequence(changes: Any) -> None:
    with pytest.raises(DocumentError, match=r"data\.changes 必须是序列"):
        ChangesData("ideas", "ideas.feed", 1, changes)


@pytest.mark.parametrize("change", ["remove", cast(Any, 3)])
def test_each_change_must_be_an_object(change: Any) -> None:
    with pytest.raises(DocumentError, match=r"data\.changes 的每一项必须是对象"):
        ChangesData("ideas", "ideas.feed", 1, [change])


def test_unknown_update_type_is_rejected() -> None:
    unknown: Any = object()

    with pytest.raises(DocumentError, match="未知的 data 更新"):
        serialize_data(unknown)


def test_updates_must_be_a_sequence() -> None:
    not_updates: Any = "nope"

    with pytest.raises(DocumentError, match="data 更新必须是序列"):
        serialize_data_updates(not_updates)


def test_updates_must_contain_data_updates() -> None:
    bad_updates: Any = [object()]

    with pytest.raises(DocumentError, match="data 更新里只能是"):
        serialize_data_updates(bad_updates)

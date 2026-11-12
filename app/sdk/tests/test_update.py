"""ops 线上形状：Python 序列化必须与跨语言 fixture 完全一致。"""

from __future__ import annotations

import json
from collections.abc import Callable, Sequence
from itertools import count
from pathlib import Path
from typing import Any, cast

import pytest

from omora.sdk.document import DocumentError, Slot
from omora.sdk.update import (
    MountOp,
    MoveOp,
    Op,
    ReplaceOp,
    UnmountOp,
    UpdateOp,
    serialize_ops,
)

_FIXTURE = Path(__file__).resolve().parent / "fixtures" / "ops.json"
_DATA: dict[str, Any] = json.loads(_FIXTURE.read_text(encoding="utf-8"))


def _noop(_payload: dict[str, Any]) -> None:
    pass


def _sequential_register() -> Callable[[Any], str]:
    counter = count()

    def register(_handler: Any) -> str:
        return f"h{next(counter)}"

    return register


def _card(slot_id: str, *, props: dict[str, Any] | None = None) -> Slot:
    return Slot(slot_id, "ideas:card", owner="ideas", props=props)


def _payload(
    ops: Sequence[Op],
    *,
    document: int = 17,
    base: int = 16,
    seq: int = 42,
) -> dict[str, Any]:
    return serialize_ops(
        ops, document=document, base=base, seq=seq, register=_sequential_register()
    )


def _fixture_ops() -> list[Op]:
    return [
        UpdateOp("ideas.search", {"value": "录音"}),
        MountOp("ideas.feed", _card("ideas.feed#43", props={"title": "新条目"}), at=1),
        MoveOp("ideas.feed#7", "ideas.feed", 0),
        UnmountOp("ideas.feed#43"),
        ReplaceOp(
            "ideas.search",
            Slot("ideas.search2", "dendro:search", owner="ideas", props={"placeholder": "再搜"}),
        ),
    ]


def test_serialized_ops_match_the_shared_fixture() -> None:
    assert _payload(_fixture_ops()) == _DATA


def test_empty_ops_serialize_to_an_empty_payload() -> None:
    assert _payload([], seq=0) == {
        "kind": "ops",
        "document": 17,
        "base": 16,
        "seq": 0,
        "ops": [],
    }


def test_mount_without_at_omits_the_position() -> None:
    node = _payload([MountOp("ideas.feed", _card("ideas.feed#1"))])["ops"][0]

    assert "at" not in node
    assert node["node"]["id"] == "ideas.feed#1"


def test_mount_at_zero_keeps_the_first_position() -> None:
    node = _payload([MountOp("ideas.feed", _card("ideas.feed#1"), at=0)])["ops"][0]

    assert node["at"] == 0


def test_node_events_are_serialized_through_the_register() -> None:
    mount = MountOp(
        "ideas.feed",
        Slot("ideas.feed#1", "ideas:card", owner="ideas", events={"click": _noop}),
    )
    replace = ReplaceOp(
        "ideas.search",
        Slot(
            "ideas.search2",
            "dendro:search",
            owner="ideas",
            events={"query": _noop, "clear": _noop},
        ),
    )

    ops = _payload([mount, replace])["ops"]

    assert ops[0]["node"]["events"] == {"click": "h0"}
    assert ops[1]["node"]["events"] == {"query": "h1", "clear": "h2"}


@pytest.mark.parametrize(
    ("build", "match"),
    [
        pytest.param(lambda: UpdateOp(" ", {}), "update.id", id="update-blank-id"),
        pytest.param(
            lambda: UpdateOp("ideas.search", cast(Any, [])),
            "update.props",
            id="update-props-not-mapping",
        ),
        pytest.param(
            lambda: MountOp(" ", _card("ideas.feed#1")), "mount.slot", id="mount-blank-slot"
        ),
        pytest.param(
            lambda: MountOp("ideas.feed", cast(Slot, object())),
            "mount.node",
            id="mount-node-not-slot",
        ),
        pytest.param(
            lambda: MountOp("ideas.feed", _card("ideas.feed#1"), at=-1),
            "mount.at",
            id="mount-negative-at",
        ),
        pytest.param(
            lambda: MountOp("ideas.feed", _card("ideas.feed#1"), at=cast(int, True)),
            "mount.at",
            id="mount-bool-at",
        ),
        pytest.param(lambda: MoveOp("", "ideas.feed", 0), "move.id", id="move-blank-id"),
        pytest.param(lambda: MoveOp("ideas.feed#7", " ", 0), "move.slot", id="move-blank-slot"),
        pytest.param(
            lambda: MoveOp("ideas.feed#7", "ideas.feed", -1), "move.at", id="move-negative-at"
        ),
        pytest.param(
            lambda: MoveOp("ideas.feed#7", "ideas.feed", cast(int, True)),
            "move.at",
            id="move-bool-at",
        ),
        pytest.param(
            lambda: MoveOp("ideas.feed#7", "ideas.feed", cast(int, "0")),
            "move.at",
            id="move-string-at",
        ),
        pytest.param(lambda: UnmountOp(""), "unmount.id", id="unmount-blank-id"),
        pytest.param(
            lambda: ReplaceOp(" ", _card("ideas.search")), "replace.id", id="replace-blank-id"
        ),
        pytest.param(
            lambda: ReplaceOp("ideas.search", cast(Slot, object())),
            "replace.node",
            id="replace-node-not-slot",
        ),
    ],
)
def test_op_construction_rejects_bad_shapes(build: Callable[[], object], match: str) -> None:
    with pytest.raises(DocumentError, match=match):
        build()


@pytest.mark.parametrize("document", [cast(int, True), cast(int, "17")])
def test_document_must_be_an_int(document: int) -> None:
    with pytest.raises(DocumentError, match="document 必须是 int"):
        serialize_ops([], document=document, base=16, seq=1, register=_sequential_register())


@pytest.mark.parametrize("base", [cast(int, True), cast(int, "16"), 0, -1])
def test_base_must_be_a_positive_int(base: int) -> None:
    with pytest.raises(DocumentError, match=r"base 必须是 >= 1 的 int"):
        serialize_ops([], document=17, base=base, seq=1, register=_sequential_register())


@pytest.mark.parametrize("seq", [cast(int, True), cast(int, "1"), -1])
def test_seq_must_be_a_non_negative_int(seq: int) -> None:
    with pytest.raises(DocumentError, match=r"seq 必须是 >= 0 的 int"):
        serialize_ops([], document=17, base=16, seq=seq, register=_sequential_register())


def test_document_must_be_one_version_after_base() -> None:
    with pytest.raises(DocumentError, match="document 必须等于 base"):
        serialize_ops([], document=17, base=15, seq=1, register=_sequential_register())


def test_ops_must_be_a_sequence() -> None:
    not_ops: Any = "nope"

    with pytest.raises(DocumentError, match="ops 必须是序列"):
        serialize_ops(not_ops, document=17, base=16, seq=1, register=_sequential_register())


def test_unknown_op_is_rejected() -> None:
    unknown: Any = [object()]

    with pytest.raises(DocumentError, match="未知的 op"):
        serialize_ops(unknown, document=17, base=16, seq=1, register=_sequential_register())

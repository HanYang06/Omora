"""树 V1 ops：线上形状以共享 fixture 为契约。"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, cast

import pytest

from omora.sdk.tree import TreeError
from omora.sdk.tree_ops import (
    DataOp,
    MountOp,
    ReplaceOp,
    SetPropsOp,
    UnmountOp,
    serialize_ops,
)

ROOT = Path(__file__).resolve().parents[3]
FIXTURE = ROOT / "app" / "sdk" / "tests" / "fixtures" / "tree-ops.json"


def _fixture() -> dict[str, Any]:
    return cast(dict[str, Any], json.loads(FIXTURE.read_text(encoding="utf-8")))


def _ops_of(batch: dict[str, Any]) -> list[Any]:
    ops = cast(list[dict[str, Any]], batch["ops"])
    set_props, mount, unmount, replace, data = ops
    return [
        SetPropsOp(set_props["id"], set_props["props"]),
        MountOp(mount["parent"], mount["node"]),
        UnmountOp(unmount["id"]),
        ReplaceOp(replace["id"], replace["node"]),
        DataOp(data["source"], data["revision"], items=data["items"]),
    ]


def test_fixture_round_trips_byte_for_byte() -> None:
    batch = _fixture()

    assert (
        serialize_ops(
            _ops_of(batch),
            document=batch["document"],
            base=batch["base"],
            seq=batch["seq"],
        )
        == batch
    )


def test_empty_batch_still_bumps_the_version() -> None:
    assert serialize_ops([], document=2, base=1, seq=0) == {
        "kind": "ops",
        "document": 2,
        "base": 1,
        "seq": 0,
        "ops": [],
    }


def test_document_must_be_base_plus_one() -> None:
    with pytest.raises(ValueError, match="base"):
        serialize_ops([], document=9, base=7, seq=0)


def test_base_and_seq_are_non_negative_ints() -> None:
    with pytest.raises(ValueError, match="base"):
        serialize_ops([], document=2, base=0, seq=0)
    with pytest.raises(ValueError, match="seq"):
        serialize_ops([], document=2, base=1, seq=-1)
    with pytest.raises(ValueError, match="int"):
        serialize_ops([], document=2, base=True, seq=0)  # bool 不是 int


def test_ids_are_16_hex() -> None:
    with pytest.raises(ValueError, match="16 位"):
        SetPropsOp("ideas.search", {"value": "x"})


def test_data_needs_exactly_one_payload() -> None:
    with pytest.raises(ValueError, match="value / items / changes"):
        DataOp("ideas.feed", 1)
    with pytest.raises(ValueError, match="value / items / changes"):
        DataOp("ideas.feed", 1, value={"a": 1}, items=[])


def test_data_revision_is_non_negative() -> None:
    with pytest.raises(ValueError, match="revision"):
        DataOp("ideas.feed", -1, value=1)


def test_node_payload_is_validated_and_copied() -> None:
    batch = _fixture()
    node = cast(dict[str, Any], batch["ops"][1]["node"])
    op = MountOp(cast(str, batch["ops"][1]["parent"]), node)

    node["settings"]["title"] = "外部改动"
    assert op.node["settings"] == {"title": "新条目"}


def test_bad_node_chain_is_rejected() -> None:
    batch = _fixture()
    node = cast(dict[str, Any], batch["ops"][1]["node"])
    node["chain"] = "a1b2c3d4e5f6a7b8.ffffffffffffffff"

    with pytest.raises(TreeError):
        MountOp(cast(str, batch["ops"][1]["parent"]), node)

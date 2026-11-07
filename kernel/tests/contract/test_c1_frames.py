"""C1 入站帧校验与 schema 的一致性。

schema 是唯一真相：这里用 jsonschema 当判官，证明 Python 侧的校验规则与
protocol/c1-frames.schema.json 对同一批边界帧给出相同结论。
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, cast

import jsonschema
import pytest
from omora_kernel.contract.c1 import InvalidFrameError, validate_request_frame

ROOT = Path(__file__).resolve().parents[3]
SCHEMA = cast(
    "dict[str, Any]",
    json.loads((ROOT / "protocol" / "c1-frames.schema.json").read_text(encoding="utf-8")),
)
FIXTURES = ROOT / "protocol" / "fixtures"

CASES: list[tuple[str, object, bool]] = [
    ("ping", {"jsonrpc": "2.0", "id": 1, "method": "ping", "params": {}}, True),
    ("snapshot", {"jsonrpc": "2.0", "id": "a", "method": "state.snapshot", "params": {}}, True),
    (
        "cmd-minimal",
        {"jsonrpc": "2.0", "id": 2, "method": "cmd.invoke", "params": {"name": "n"}},
        True,
    ),
    (
        "cmd-full",
        {
            "jsonrpc": "2.0",
            "id": 3,
            "method": "cmd.invoke",
            "params": {"name": "note.create", "args": {"title": "t"}, "idempotencyKey": "abcdefgh"},
        },
        True,
    ),
    (
        "query-cursor",
        {
            "jsonrpc": "2.0",
            "id": 4,
            "method": "query.invoke",
            "params": {"name": "note.list", "cursor": None, "limit": 500},
        },
        True,
    ),
    (
        "subscribe-zero",
        {"jsonrpc": "2.0", "id": 5, "method": "event.subscribe", "params": {"since": 0}},
        True,
    ),
    ("integer-id-float", {"jsonrpc": "2.0", "id": 1.0, "method": "ping", "params": {}}, True),
    ("missing-params", {"jsonrpc": "2.0", "id": 1, "method": "ping"}, False),
    ("unknown-method", {"jsonrpc": "2.0", "id": 1, "method": "note.unknown", "params": {}}, False),
    ("wrong-jsonrpc", {"jsonrpc": "1.0", "id": 1, "method": "ping", "params": {}}, False),
    ("null-id", {"jsonrpc": "2.0", "id": None, "method": "ping", "params": {}}, False),
    ("bool-id", {"jsonrpc": "2.0", "id": True, "method": "ping", "params": {}}, False),
    ("missing-id", {"jsonrpc": "2.0", "method": "ping", "params": {}}, False),
    ("extra-frame-key", {"jsonrpc": "2.0", "id": 1, "method": "ping", "params": {}, "x": 1}, False),
    (
        "cmd-missing-name",
        {"jsonrpc": "2.0", "id": 1, "method": "cmd.invoke", "params": {"args": {}}},
        False,
    ),
    (
        "short-idempotency-key",
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "cmd.invoke",
            "params": {"name": "n", "idempotencyKey": "short"},
        },
        False,
    ),
    (
        "args-not-object",
        {"jsonrpc": "2.0", "id": 1, "method": "cmd.invoke", "params": {"name": "n", "args": []}},
        False,
    ),
    (
        "limit-too-small",
        {"jsonrpc": "2.0", "id": 1, "method": "query.invoke", "params": {"name": "n", "limit": 0}},
        False,
    ),
    (
        "limit-too-large",
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "query.invoke",
            "params": {"name": "n", "limit": 501},
        },
        False,
    ),
    (
        "cursor-not-integer",
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "query.invoke",
            "params": {"name": "n", "cursor": 1.5},
        },
        False,
    ),
    (
        "negative-since",
        {"jsonrpc": "2.0", "id": 1, "method": "event.subscribe", "params": {"since": -1}},
        False,
    ),
    ("extra-ping-field", {"jsonrpc": "2.0", "id": 1, "method": "ping", "params": {"x": 1}}, False),
    ("non-object", [1], False),
]


def _schema_accepts(payload: object) -> bool:
    try:
        jsonschema.validate(instance=payload, schema=SCHEMA)
    except jsonschema.ValidationError:
        return False
    return True


def _validator_accepts(payload: object) -> bool:
    try:
        validate_request_frame(payload)
    except InvalidFrameError:
        return False
    return True


@pytest.mark.parametrize(("name", "payload", "expected"), CASES, ids=[case[0] for case in CASES])
def test_validator_agrees_with_frame_schema(name: str, payload: object, expected: bool) -> None:
    assert _validator_accepts(payload) is expected
    assert _schema_accepts(payload) is expected


def test_valid_fixture_is_accepted() -> None:
    payload = json.loads((FIXTURES / "c1-frames.valid.json").read_text(encoding="utf-8"))
    frame = validate_request_frame(payload)
    assert frame.method == "cmd.invoke"
    assert frame.params["name"] == "ideas.create"


def test_invalid_fixture_is_rejected() -> None:
    payload = json.loads((FIXTURES / "c1-frames.invalid.json").read_text(encoding="utf-8"))
    with pytest.raises(InvalidFrameError):
        validate_request_frame(payload)

import json
from pathlib import Path
from typing import Any

import pytest

from omora.sdk.protocol import (
    FrameError,
    error_frame,
    event_frame,
    parse_call,
    parse_event,
    result_frame,
)

FIXTURES = Path(__file__).parent / "fixtures" / "protocol.json"

DATA: dict[str, Any] = json.loads(FIXTURES.read_text(encoding="utf-8"))
CASES: list[dict[str, Any]] = DATA["calls"]
EVENTS: list[dict[str, Any]] = DATA["events"]


@pytest.mark.parametrize("case", CASES, ids=[case["name"] for case in CASES])
def test_call_frames_match_the_shared_contract(case: dict[str, Any]) -> None:
    if case["ok"]:
        call = parse_call(case["frame"])
        assert (call.target, call.method) == (case["frame"]["target"], case["frame"]["method"])
        assert call.id == case["frame"]["id"]
        return

    with pytest.raises(FrameError) as info:
        parse_call(case["frame"])

    assert info.value.code == case["code"]


@pytest.mark.parametrize("case", EVENTS, ids=[case["name"] for case in EVENTS])
def test_event_frames_match_the_shared_contract(case: dict[str, Any]) -> None:
    if case["ok"]:
        event = parse_event(case["frame"])
        assert event.topic == case["frame"]["topic"]
        assert event.payload == case["frame"].get("payload", {})
        return

    with pytest.raises(FrameError) as info:
        parse_event(case["frame"])

    assert info.value.code == case["code"]


def test_subscribe_is_an_ordinary_call() -> None:
    subscribe = next(case for case in CASES if case["name"] == "subscribe")

    call = parse_call(subscribe["frame"])

    assert (call.target, call.method) == ("net", "subscribe")
    assert call.args == {"topics": ["ideas.changed", "media.progress"]}


def test_event_frame_carries_the_topic_and_payload() -> None:
    assert event_frame("ideas.changed", {"version": 8}) == {
        "type": "event",
        "topic": "ideas.changed",
        "payload": {"version": 8},
    }


def test_result_frame_echoes_the_id_and_carries_the_value() -> None:
    frame = result_frame("7", [{"type": "text", "props": {"text": "hi"}, "children": []}])

    assert frame == {
        "id": "7",
        "type": "result",
        "value": [{"type": "text", "props": {"text": "hi"}, "children": []}],
    }


def test_error_frame_keeps_a_null_id_when_the_frame_never_parsed() -> None:
    frame = error_frame(None, "bad_frame", "帧必须是对象")

    assert frame == {"id": None, "type": "error", "code": "bad_frame", "message": "帧必须是对象"}

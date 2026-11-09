import json
from pathlib import Path
from typing import Any

import pytest

from omora.sdk.protocol import FrameError, error_frame, parse_call, result_frame

FIXTURES = Path(__file__).parent / "fixtures" / "protocol.json"

CASES: list[dict[str, Any]] = json.loads(FIXTURES.read_text(encoding="utf-8"))


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

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
from omora.sdk.ui import Column, Handler, List, Result, Search, Suggestion, serialize

FIXTURES = Path(__file__).parent / "fixtures" / "protocol.json"

DATA: dict[str, Any] = json.loads(FIXTURES.read_text(encoding="utf-8"))
CASES: list[dict[str, Any]] = DATA["calls"]
EVENTS: list[dict[str, Any]] = DATA["events"]
SNAPSHOT: dict[str, Any] = DATA["snapshots"][0]["snapshot"]


def _noop(payload: dict[str, Any]) -> None:
    pass


def _ids(*names: str) -> Any:
    remaining = iter(names)

    def register(handler: Handler) -> str:
        return next(remaining)

    return register


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
    assert call.args == {"topics": ["ui.snapshot", "media.progress"]}


def test_event_frame_carries_the_topic_and_payload() -> None:
    assert event_frame("ui.snapshot", {"version": 8}) == {
        "type": "event",
        "topic": "ui.snapshot",
        "payload": {"version": 8},
    }


def _nodes(node: dict[str, Any]) -> list[dict[str, Any]]:
    found = [node]
    for child in node["children"]:
        found.extend(_nodes(child))
    return found


def test_the_snapshot_fixture_keeps_the_shared_shape() -> None:
    snapshots = DATA["snapshots"]
    assert snapshots, "协议 fixture 至少带一份页面快照"

    for case in snapshots:
        snapshot = case["snapshot"]
        assert set(snapshot) == {"pages", "page", "meta", "content", "version"}, case["name"]
        assert isinstance(snapshot["version"], int), case["name"]
        assert isinstance(snapshot["pages"], list), case["name"]
        assert snapshot["pages"], case["name"]
        assert isinstance(snapshot["page"], str), case["name"]
        assert isinstance(snapshot["meta"], str), case["name"]
        for node in _nodes(snapshot["content"]):
            assert isinstance(node["type"], str), case["name"]
            assert node["type"], case["name"]
            assert isinstance(node["props"], dict), case["name"]
            assert isinstance(node["children"], list), case["name"]


def test_the_fixture_pins_the_search_nodes() -> None:
    snapshot = DATA["snapshots"][0]["snapshot"]
    nodes = _nodes(snapshot["content"])
    by_type = {node["type"]: node for node in nodes}

    assert {"search", "suggestion", "result"} <= set(by_type)
    assert set(by_type["suggestion"]["props"]) == {
        "value",
        "title",
        "meta",
        "highlight",
        "on_pick",
    }
    assert set(by_type["result"]["props"]) == {
        "title",
        "snippet",
        "meta",
        "highlight",
        "on_click",
    }
    assert set(by_type["search"]["props"]) == {"placeholder", "value", "on_query", "on_submit"}


def test_the_search_page_serializes_to_the_snapshot_fixture() -> None:
    tree = Column(
        Search(
            Suggestion(
                value="买牛奶", title="买牛奶", meta="刚刚", highlight="牛奶", on_pick=_noop
            ),
            placeholder="搜索灵感…",
            value="牛奶",
            on_query=_noop,
            on_submit=_noop,
        ),
        List(
            Result(
                title="买牛奶",
                snippet="…下班顺路买牛奶…",
                meta="置顶 · 刚刚 · 语音",
                highlight="牛奶",
                on_click=_noop,
            )
        ),
    )

    node = serialize(tree, _ids("ideas:3:0", "ideas:3:1", "ideas:3:2", "ideas:3:3"))

    assert node == SNAPSHOT["content"]


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

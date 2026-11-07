"""事件日志的行为：revision 单调、范围读取、追赶、事务内追加与重放一致。"""

from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path
from typing import cast

from omora_kernel.eventlog import Event, EventLog
from omora_kernel.store import Store


def replay(events: Sequence[Event]) -> dict[str, int]:
    state: dict[str, int] = {}
    for event in events:
        key = cast("str", event.data["key"])
        value = cast("int", event.data["value"])
        if event.type == "set":
            state[key] = value
        elif event.type == "add":
            state[key] = state.get(key, 0) + value
    return state


def test_append_assigns_increasing_revisions(tmp_path: Path) -> None:
    store = Store(tmp_path / "events.db")
    try:
        log = EventLog(store)
        revisions = [
            log.append("set", {"key": f"k{index}", "value": index}).revision for index in range(3)
        ]

        assert revisions == [1, 2, 3]
    finally:
        store.close()


def test_revisions_continue_after_restart(tmp_path: Path) -> None:
    path = tmp_path / "events.db"
    store = Store(path)
    try:
        log = EventLog(store)
        log.append("set", {"key": "a", "value": 1})
        log.append("set", {"key": "b", "value": 2})
    finally:
        store.close()

    reopened = Store(path)
    try:
        assert EventLog(reopened).append("set", {"key": "c", "value": 3}).revision == 3
    finally:
        reopened.close()


def test_read_returns_requested_revision_range(tmp_path: Path) -> None:
    store = Store(tmp_path / "events.db")
    try:
        log = EventLog(store)
        for key in ("a", "b", "c"):
            log.append("set", {"key": key, "value": 1})

        events = log.read(from_revision=2, to_revision=3)

        assert [event.revision for event in events] == [2, 3]
        assert [cast("str", event.data["key"]) for event in events] == ["b", "c"]
        assert log.read(from_revision=4) == []
    finally:
        store.close()


def test_catch_up_returns_events_after_revision(tmp_path: Path) -> None:
    store = Store(tmp_path / "events.db")
    try:
        log = EventLog(store)
        for index in range(4):
            log.append("set", {"key": f"k{index}", "value": index})

        caught = log.catch_up(2)

        assert [event.revision for event in caught] == [3, 4]
    finally:
        store.close()


def test_event_data_round_trips_through_storage(tmp_path: Path) -> None:
    store = Store(tmp_path / "events.db")
    try:
        log = EventLog(store)
        payload: dict[str, object] = {
            "key": "a",
            "value": 1,
            "tags": ["x", "y"],
            "nested": {"flag": True},
        }
        log.append("set", payload)

        assert log.read()[0].data == payload
    finally:
        store.close()


def test_append_rolls_back_with_outer_transaction(tmp_path: Path) -> None:
    store = Store(tmp_path / "events.db")
    try:
        log = EventLog(store)
        log.append("set", {"key": "kept", "value": 1})
        try:
            with store.transaction():
                log.append("set", {"key": "discarded", "value": 2})
                raise RuntimeError("boom")
        except RuntimeError:
            pass

        assert [event.revision for event in log.read()] == [1]
    finally:
        store.close()


def test_replay_after_restart_matches_live_projection(tmp_path: Path) -> None:
    path = tmp_path / "events.db"
    store = Store(path)
    try:
        log = EventLog(store)
        log.append("set", {"key": "alpha", "value": 1})
        log.append("add", {"key": "alpha", "value": 2})
        live = replay(log.read())
    finally:
        store.close()

    reopened = Store(path)
    try:
        restored = replay(EventLog(reopened).read())
    finally:
        reopened.close()

    assert restored == live
    assert live == {"alpha": 3}

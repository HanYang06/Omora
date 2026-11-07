"""事件投影的行为：折叠、重建一致性、未知事件跳过、revision 跟随。"""

from __future__ import annotations

import asyncio
from typing import cast

from omora_kernel.contract.c1 import SnapshotProvider
from omora_kernel.eventlog import Event, EventLog
from omora_kernel.projection import Projection, ProjectionSnapshot
from omora_kernel.store import Store


def add_event(revision: int, value: int, key: str = "a") -> Event:
    return Event(revision=revision, type="counter.add", data={"key": key, "value": value})


def add_amount(state: dict[str, object], event: Event) -> None:
    key = cast("str", event.data["key"])
    state[key] = cast("int", state.get(key, 0)) + cast("int", event.data["value"])


def test_apply_folds_registered_events_into_state() -> None:
    projection = Projection()
    projection.register("counter.add", add_amount)

    folded = [projection.apply(add_event(1, 2)), projection.apply(add_event(2, 3))]

    assert folded == [True, True]
    assert projection.state() == {"a": 5}


def test_rebuild_matches_incremental_apply() -> None:
    events = [add_event(1, 2), add_event(2, 5), add_event(3, 1, key="b")]

    incremental = Projection()
    incremental.register("counter.add", add_amount)
    for event in events:
        incremental.apply(event)

    rebuilt = Projection()
    rebuilt.register("counter.add", add_amount)
    skipped = rebuilt.rebuild(events)

    assert rebuilt.state() == incremental.state()
    assert rebuilt.revision == incremental.revision
    assert skipped == 0


def test_unknown_event_is_skipped_without_touching_state() -> None:
    projection = Projection()
    projection.register("counter.add", add_amount)
    projection.apply(add_event(1, 1))

    folded = projection.apply(
        Event(revision=2, type="counter.multiply", data={"key": "a", "value": 5})
    )

    assert folded is False
    assert projection.state() == {"a": 1}
    assert projection.skipped == 1
    assert projection.revision == 2


def test_rebuild_counts_skipped_unknown_events() -> None:
    projection = Projection()
    projection.register("counter.add", add_amount)

    skipped = projection.rebuild(
        [
            add_event(1, 1),
            Event(revision=2, type="counter.multiply", data={"value": 2}),
            Event(revision=3, type="counter.rename", data={"key": "b"}),
        ]
    )

    assert skipped == 2
    assert projection.skipped == 2
    assert projection.state() == {"a": 1}


def test_revision_follows_event_revision() -> None:
    projection = Projection()
    projection.register("counter.add", add_amount)

    projection.apply(add_event(3, 1))
    projection.apply(add_event(7, 1))

    assert projection.revision == 7


def test_duplicate_reducer_registration_is_rejected() -> None:
    projection = Projection()
    projection.register("counter.add", add_amount)

    try:
        projection.register("counter.add", add_amount)
    except ValueError:
        return
    raise AssertionError("同一事件类型重复登记 reducer 应被拒绝")


def test_state_snapshot_is_detached_from_projection() -> None:
    projection = Projection()
    projection.register("counter.add", add_amount)
    projection.apply(add_event(1, 4))

    snapshot = projection.state()
    snapshot["a"] = 99

    assert projection.state() == {"a": 4}


def test_non_increasing_revision_is_rejected_without_double_folding() -> None:
    projection = Projection()
    projection.register("counter.add", add_amount)
    projection.apply(add_event(2, 1))

    try:
        projection.apply(add_event(2, 10))
    except ValueError:
        pass
    else:
        raise AssertionError("revision 未递增的事件应被拒绝")

    assert projection.state() == {"a": 1}


def test_rebuild_from_event_log_matches_live_projection() -> None:
    store = Store(":memory:")
    try:
        log = EventLog(store)
        live = Projection()
        live.register("counter.add", add_amount)
        for key, value in (("a", 2), ("a", 3), ("b", 1)):
            live.apply(log.append("counter.add", {"key": key, "value": value}))

        rebuilt = Projection()
        rebuilt.register("counter.add", add_amount)

        assert rebuilt.rebuild(log.read()) == 0
        assert rebuilt.state() == live.state()
        assert rebuilt.revision == live.revision
    finally:
        store.close()


def test_projection_snapshot_satisfies_c1_snapshot_provider() -> None:
    projection = Projection()
    projection.register("counter.add", add_amount)
    projection.apply(add_event(4, 2))
    port: SnapshotProvider = ProjectionSnapshot(projection)

    assert asyncio.run(port.snapshot()) == (4, {"a": 2})
    assert asyncio.run(port.current_revision()) == 4

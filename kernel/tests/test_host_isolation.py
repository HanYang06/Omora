"""插件之间互不可见的行为:状态切片、命令作用域、reducer、订阅与槽位顺序。"""

from __future__ import annotations

import asyncio
from pathlib import Path

import pytest
from host_support import (
    NOTE_SOURCE,
    OTHER_SOURCE,
    REDUCER_SOURCE,
    FakeRuntime,
    PluginSpec,
    RecordingLog,
    make_host,
    view_source,
    write_plugin,
)
from omora_kernel.context import UnavailableError
from omora_sdk import text


def test_each_plugin_reads_only_its_own_state_slice(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    runtime = FakeRuntime({"note.good": {"count": 1}, "note.other": {"count": 2}})
    host = make_host(runtime, RecordingLog())
    write_plugin(
        tmp_path,
        PluginSpec(
            "a_good",
            "i1_good",
            "note.good",
            NOTE_SOURCE,
            slots=({"id": "note.panel", "slot": "sidebar", "order": 1},),
        ),
        monkeypatch,
    )
    write_plugin(
        tmp_path, PluginSpec("b_other", "i1_other", "note.other", OTHER_SOURCE), monkeypatch
    )
    host.discover(tmp_path)
    asyncio.run(host.start())

    assert asyncio.run(host.commands.invoke("note.create", {})) == {"items": [{"count": 1}]}
    assert asyncio.run(host.commands.invoke("note.other", {})) == {"items": [{"count": 2}]}


def test_deactivating_one_plugin_keeps_the_other_dispatchable(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    runtime = FakeRuntime({"note.good": {"count": 1}, "note.other": {"count": 2}})
    host = make_host(runtime, RecordingLog())
    write_plugin(
        tmp_path,
        PluginSpec(
            "a_good",
            "i2_good",
            "note.good",
            NOTE_SOURCE,
            slots=({"id": "note.panel", "slot": "sidebar", "order": 1},),
        ),
        monkeypatch,
    )
    write_plugin(
        tmp_path, PluginSpec("b_other", "i2_other", "note.other", OTHER_SOURCE), monkeypatch
    )
    host.discover(tmp_path)
    asyncio.run(host.start())

    asyncio.run(host.deactivate("note.good"))

    assert host.commands.names() == ("note.other",)
    assert asyncio.run(host.commands.invoke("note.other", {})) == {"items": [{"count": 2}]}
    try:
        asyncio.run(host.commands.invoke("note.create", {}))
    except UnavailableError as error:
        assert error.token == "note.create"
        return
    raise AssertionError("已卸载插件的命令不应还能分发")


def test_reducer_is_bound_to_plugin_and_disabled_after_deactivate(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    runtime = FakeRuntime()
    host = make_host(runtime, RecordingLog())
    write_plugin(
        tmp_path,
        PluginSpec("a_reducer", "i3_reducer", "note.reducer", REDUCER_SOURCE),
        monkeypatch,
    )
    host.discover(tmp_path)
    asyncio.run(host.start())

    assert len(runtime.reducers) == 1
    plugin_id, event_type, reducer = runtime.reducers[0]
    assert (plugin_id, event_type) == ("note.reducer", "note.changed")

    slice_state: dict[str, object] = {"count": 1}
    reducer(slice_state, {"delta": 2})
    assert slice_state == {"count": 3}

    asyncio.run(host.deactivate("note.reducer"))
    reducer(slice_state, {"delta": 5})
    assert slice_state == {"count": 3}


def test_deactivation_unsubscribes_plugin_events(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    runtime = FakeRuntime()
    host = make_host(runtime, RecordingLog())
    write_plugin(
        tmp_path,
        PluginSpec("a_reducer", "i4_reducer", "note.reducer", REDUCER_SOURCE),
        monkeypatch,
    )
    host.discover(tmp_path)
    asyncio.run(host.start())

    assert [event_type for event_type, _, _ in runtime.listeners] == ["note.changed"]
    cancelled = runtime.listeners[0][2]
    assert cancelled == [False]

    asyncio.run(host.deactivate("note.reducer"))

    assert cancelled == [True]


def test_slot_contributions_are_ordered_by_manifest_order(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    host = make_host(FakeRuntime(), RecordingLog())
    write_plugin(
        tmp_path,
        PluginSpec(
            "a_second",
            "i5_second",
            "note.second",
            view_source("second"),
            slots=({"id": "note.panel", "slot": "sidebar", "order": 2},),
        ),
        monkeypatch,
    )
    write_plugin(
        tmp_path,
        PluginSpec(
            "b_first",
            "i5_first",
            "note.first",
            view_source("first"),
            slots=({"id": "note.panel", "slot": "sidebar", "order": 1},),
        ),
        monkeypatch,
    )
    host.discover(tmp_path)
    asyncio.run(host.start())

    assert host.snapshot_ui()["slots"] == {
        "sidebar": [
            {"owner": "note.first", "nodes": [text("first")]},
            {"owner": "note.second", "nodes": [text("second")]},
        ]
    }

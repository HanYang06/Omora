"""插件宿主的行为:发现、激活、卸载、失败隔离与释放。"""

from __future__ import annotations

import asyncio
from pathlib import Path

import pytest
from host_support import (
    FAILING_SOURCE,
    NOTE_SOURCE,
    OTHER_SOURCE,
    FakeRuntime,
    PluginSpec,
    RecordingLog,
    make_host,
    write_plugin,
)
from omora_kernel.context import UnavailableError
from omora_sdk import text


def test_discover_skips_bad_manifests_and_keeps_valid_one(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    log = RecordingLog()
    host = make_host(FakeRuntime(), log)
    write_plugin(
        tmp_path,
        PluginSpec(
            "a_good",
            "h1_good",
            "note.good",
            NOTE_SOURCE,
            slots=({"id": "note.panel", "slot": "sidebar", "order": 1},),
        ),
        monkeypatch,
    )
    write_plugin(
        tmp_path,
        PluginSpec(
            "b_invalid",
            "h1_invalid",
            "note.invalid",
            NOTE_SOURCE,
            capabilities=("commands", "teleport"),
        ),
        monkeypatch,
    )
    write_plugin(
        tmp_path,
        PluginSpec("c_old", "h1_old", "note.old", NOTE_SOURCE, engines="^0.2.0"),
        monkeypatch,
    )
    write_plugin(
        tmp_path, PluginSpec("d_broken", "h1_broken", "note.broken", NOTE_SOURCE), monkeypatch
    )
    (tmp_path / "d_broken" / "plugin.json").write_text("{broken", encoding="utf-8")

    discovered = host.discover(tmp_path)

    assert discovered == ("note.good",)
    assert sum("跳过插件" in message for message in log.messages) == 2
    assert sum("无法读取清单" in message for message in log.messages) == 1
    assert asyncio.run(host.start()) == ("note.good",)


def test_activation_exposes_command_contribution_and_emitted_event(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    runtime = FakeRuntime({"note.good": {"count": 1}})
    host = make_host(runtime, RecordingLog())
    write_plugin(
        tmp_path,
        PluginSpec(
            "a_good",
            "h2_good",
            "note.good",
            NOTE_SOURCE,
            slots=({"id": "note.panel", "slot": "sidebar", "order": 1},),
        ),
        monkeypatch,
    )
    host.discover(tmp_path)

    assert asyncio.run(host.start()) == ("note.good",)
    assert asyncio.run(host.commands.invoke("note.create", {})) == {"items": [{"count": 1}]}
    assert host.snapshot_ui() == {
        "slots": {"sidebar": [{"owner": "note.good", "nodes": [text("note")]}]}
    }
    assert runtime.emitted == [("note.ready", {"plugin": "note.good"})]


def test_deactivation_removes_command_and_contribution(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    log = RecordingLog()
    host = make_host(FakeRuntime({"note.good": {"count": 1}}), log)
    write_plugin(
        tmp_path,
        PluginSpec(
            "a_good",
            "h3_good",
            "note.good",
            NOTE_SOURCE,
            slots=({"id": "note.panel", "slot": "sidebar"},),
        ),
        monkeypatch,
    )
    host.discover(tmp_path)
    asyncio.run(host.start())

    asyncio.run(host.deactivate("note.good"))

    assert host.commands.names() == ()
    assert host.queries.names() == ()
    assert host.snapshot_ui() == {"slots": {}}
    assert any("[note.good] deactivated" in message for message in log.messages)
    try:
        asyncio.run(host.commands.invoke("note.create", {}))
    except UnavailableError as error:
        assert error.code == "E_UNAVAILABLE"
        assert error.token == "note.create"
        return
    raise AssertionError("卸载后命令不应还能分发")


def test_activation_failure_rolls_back_without_blocking_others(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    log = RecordingLog()
    host = make_host(FakeRuntime(), log)
    write_plugin(tmp_path, PluginSpec("a_bad", "h4_bad", "note.bad", FAILING_SOURCE), monkeypatch)
    write_plugin(tmp_path, PluginSpec("b_good", "h4_good", "note.good", OTHER_SOURCE), monkeypatch)
    host.discover(tmp_path)

    activated = asyncio.run(host.start())

    assert activated == ("note.good",)
    assert host.commands.names() == ("note.other",)
    assert any("激活失败" in message for message in log.messages)
    try:
        asyncio.run(host.commands.invoke("bad.run", {}))
    except UnavailableError as error:
        assert error.token == "bad.run"
        return
    raise AssertionError("激活失败插件的命令不应残留")


def test_start_ignores_plugins_without_on_startup_activation(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    host = make_host(FakeRuntime(), RecordingLog())
    write_plugin(
        tmp_path,
        PluginSpec(
            "a_late",
            "h5_late",
            "note.late",
            OTHER_SOURCE,
            activation=("onCommand:note.other",),
        ),
        monkeypatch,
    )
    host.discover(tmp_path)

    assert asyncio.run(host.start()) == ()
    assert host.commands.names() == ()

    asyncio.run(host.activate("note.late"))

    assert host.commands.names() == ("note.other",)


def test_close_deactivates_all_plugins(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    log = RecordingLog()
    host = make_host(FakeRuntime(), log)
    write_plugin(
        tmp_path,
        PluginSpec(
            "a_good",
            "h6_good",
            "note.good",
            NOTE_SOURCE,
            slots=({"id": "note.panel", "slot": "sidebar"},),
        ),
        monkeypatch,
    )
    host.discover(tmp_path)
    asyncio.run(host.start())

    asyncio.run(host.close())

    assert host.commands.names() == ()
    assert host.snapshot_ui() == {"slots": {}}
    assert any("[note.good] deactivated" in message for message in log.messages)

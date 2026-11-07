"""能力授权:清单里没声明的能力,运行期真的会被拒绝。"""

from __future__ import annotations

import asyncio
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import cast

import pytest
from host_support import (
    FakeRuntime,
    PluginSpec,
    RecordingLog,
    make_host,
    write_plugin,
)
from omora_kernel.capabilities import Capabilities, DeniedError
from omora_kernel.context import Context
from omora_kernel.plugin_context import PluginEnvironment
from omora_kernel.providers import ServiceProviders
from omora_kernel.registry import CommandRegistry, QueryRegistry
from omora_sdk import Node

COMMAND_SOURCE = """
class Plugin:
    async def activate(self, context):
        async def handler(args):
            return None

        context.commands.register("note.make", handler)

    async def deactivate(self) -> None:
        pass


plugin = Plugin()
"""

UI_SOURCE = """
from omora_sdk import text


class Plugin:
    async def activate(self, context):
        context.ui.contribute("note.panel", self.view)

    async def deactivate(self) -> None:
        pass

    def view(self, state):
        return [text("x")]


plugin = Plugin()
"""


def test_capabilities_require_rejects_missing() -> None:
    granted = Capabilities(["events"])

    assert granted.granted() == ("events",)
    with pytest.raises(DeniedError) as caught:
        granted.require("commands", "注册命令")
    assert caught.value.code == "E_DENIED", "拒绝必须以 E_DENIED 表达"
    assert caught.value.capability == "commands"


def _environment(granted: list[str]) -> PluginEnvironment:
    scope = Context("plugin")
    return PluginEnvironment(
        plugin_id="note.test",
        scope=scope,
        runtime=FakeRuntime(),
        commands=CommandRegistry(),
        queries=QueryRegistry(),
        services=ServiceProviders(),
        sink=RecordingLog(),
        ids=object(),  # type: ignore[arg-type]
        clock=object(),  # type: ignore[arg-type]
        declared={"note.panel": ("sidebar", 0)},
        views={},
        capabilities=Capabilities(granted),
    )


def test_context_api_is_gated_by_declared_capabilities() -> None:
    context = _environment(["events"]).context()

    with pytest.raises(DeniedError):
        context.commands.register("note.make", _noop)
    with pytest.raises(DeniedError):
        context.queries.register("note.list", _noop)
    with pytest.raises(DeniedError):
        context.ui.contribute("note.panel", _view)
    with pytest.raises(DeniedError):
        context.services.provide("note.lookup", _noop)
    context.log.info("日志永远允许,它是用来诊断拒绝的")


async def _noop(_args: object) -> object:
    return None


def _view(_state: Mapping[str, object]) -> Sequence[Node]:
    return []


def test_plugin_without_command_capability_fails_activation(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    log = RecordingLog()
    host = make_host(FakeRuntime(), log)
    write_plugin(
        tmp_path,
        PluginSpec(
            directory="note",
            module="note_plugin",
            plugin_id="note.good",
            source=COMMAND_SOURCE,
            capabilities=("events", "ui"),
        ),
        monkeypatch,
    )
    host.discover(tmp_path)

    assert asyncio.run(host.start()) == (), "缺能力的插件不应该被激活"
    assert host.commands.names() == (), "注册失败不能留下半条命令"
    assert any("E_DENIED" in message or "缺少能力" in message for message in log.messages), (
        "拒绝要记进日志,否则没法排查"
    )


def test_plugin_with_ui_capability_can_contribute(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    host = make_host(FakeRuntime(), RecordingLog())
    write_plugin(
        tmp_path,
        PluginSpec(
            directory="uipanel",
            module="ui_plugin",
            plugin_id="note.ui",
            source=UI_SOURCE,
            capabilities=("ui",),
            slots=({"id": "note.panel", "slot": "sidebar"},),
        ),
        monkeypatch,
    )
    host.discover(tmp_path)
    asyncio.run(host.start())

    slots = cast("dict[str, object]", host.snapshot_ui()["slots"])
    assert "sidebar" in slots, "授予了 ui 就应该能贡献"

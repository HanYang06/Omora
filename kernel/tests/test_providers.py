"""跨插件服务：提供方登记，消费方调用；提供方卸载后服务消失。"""

from __future__ import annotations

import asyncio
from pathlib import Path

import pytest
from host_support import (
    FakeRuntime,
    PluginSpec,
    RecordingLog,
    make_host,
    write_plugin,
)
from omora_kernel.context import Context, UnavailableError
from omora_kernel.providers import ServiceProviders

PROVIDER = """
class Plugin:
    async def activate(self, context):
        async def lookup(args):
            if args.get("id") != "known":
                raise ValueError("未知 id")
            return {"id": "known"}

        context.services.provide("note.lookup", lookup)

    async def deactivate(self) -> None:
        pass


plugin = Plugin()
"""

CONSUMER = """
class Plugin:
    async def activate(self, context):
        async def fetch(args):
            return await context.services.call("note.lookup", args)

        context.commands.register("note.fetch", fetch)

    async def deactivate(self) -> None:
        pass


plugin = Plugin()
"""


def _install(root: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    write_plugin(
        root,
        PluginSpec(
            directory="provider",
            module="provider_plugin",
            plugin_id="note.provider",
            source=PROVIDER,
            capabilities=("events", "commands", "services"),
        ),
        monkeypatch,
    )
    write_plugin(
        root,
        PluginSpec(
            directory="consumer",
            module="consumer_plugin",
            plugin_id="note.consumer",
            source=CONSUMER,
            capabilities=("events", "commands", "services"),
        ),
        monkeypatch,
    )


def test_consumer_calls_service_provided_by_another_plugin(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    host = make_host(FakeRuntime(), RecordingLog())
    _install(tmp_path, monkeypatch)
    host.discover(tmp_path)
    asyncio.run(host.start())
    result = asyncio.run(host.commands.invoke("note.fetch", {"id": "known"}))
    assert result == {"id": "known"}, "跨插件调用必须拿到提供方的返回值"


def test_service_errors_propagate_unchanged(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    host = make_host(FakeRuntime(), RecordingLog())
    _install(tmp_path, monkeypatch)
    host.discover(tmp_path)
    asyncio.run(host.start())
    with pytest.raises(ValueError, match="未知 id"):
        asyncio.run(host.commands.invoke("note.fetch", {"id": "missing"}))


def test_unloading_provider_removes_the_service(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    host = make_host(FakeRuntime(), RecordingLog())
    _install(tmp_path, monkeypatch)
    host.discover(tmp_path)
    asyncio.run(host.start())
    assert host.services.names() == ("note.lookup",)

    asyncio.run(host.deactivate("note.provider"))
    assert host.services.names() == (), "提供方卸载后不应留下服务名"
    with pytest.raises(UnavailableError) as caught:
        asyncio.run(host.commands.invoke("note.fetch", {"id": "known"}))
    assert caught.value.code == "E_UNAVAILABLE", "服务消失必须以 E_UNAVAILABLE 表达"


def test_service_is_bound_to_provider_scope() -> None:
    providers = ServiceProviders()
    scope = Context("provider")

    async def handler(args: dict[str, object]) -> object:
        return {"echo": args}

    providers.provide(scope, "note.echo", handler)  # type: ignore[arg-type]
    assert asyncio.run(providers.call("note.echo", {"value": 1})) == {"echo": {"value": 1}}

    asyncio.run(scope.dispose())
    with pytest.raises(UnavailableError):
        asyncio.run(providers.call("note.echo", {}))


def test_duplicate_service_name_is_rejected() -> None:
    providers = ServiceProviders()
    first = Context("first")
    second = Context("second")

    async def handler(args: dict[str, object]) -> object:
        return {}

    providers.provide(first, "note.echo", handler)  # type: ignore[arg-type]
    with pytest.raises(ValueError, match="已被提供"):
        providers.provide(second, "note.echo", handler)  # type: ignore[arg-type]

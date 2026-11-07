"""事件订阅：补发、去重、退订与不被请求阻塞。"""

from __future__ import annotations

import asyncio
from collections.abc import Mapping

from omora_kernel.contract.c1 import Event
from omora_kernel.transport.ws import C1Handlers

from .support import (
    FakeEventSource,
    FakeInvoker,
    FakeSnapshots,
    connected,
    receive,
    send_request,
)


def _handlers(source: FakeEventSource, commands: FakeInvoker | None = None) -> C1Handlers:
    return C1Handlers(
        commands=commands or FakeInvoker(),
        queries=FakeInvoker(),
        snapshots=FakeSnapshots(),
        events=source,
    )


def _events() -> list[Event]:
    return [
        Event(type="note.created", revision=index, data={"index": index}) for index in range(1, 6)
    ]


def test_subscribe_backfills_events_after_since() -> None:
    async def scenario() -> None:
        async with connected(_handlers(FakeEventSource(_events()))) as client:
            await send_request(client, 1, "event.subscribe", {"since": 2})
            frames = [await receive(client) for _ in range(4)]
            results = [frame for frame in frames if "result" in frame]
            events = [frame["params"] for frame in frames if "method" in frame]
            assert results == [{"jsonrpc": "2.0", "id": 1, "result": {"revision": 5}}]
            assert events == [
                {"type": "note.created", "revision": 3, "data": {"index": 3}},
                {"type": "note.created", "revision": 4, "data": {"index": 4}},
                {"type": "note.created", "revision": 5, "data": {"index": 5}},
            ]

    asyncio.run(scenario())


def test_live_stream_only_sends_revisions_above_subscription_start() -> None:
    async def scenario() -> None:
        source = FakeEventSource(_events())
        async with connected(_handlers(source)) as client:
            await send_request(client, 1, "event.subscribe", {"since": 5})
            assert (await receive(client))["result"] == {"revision": 5}
            await source.emit("note.created", 5, {"marker": "duplicate"})
            await source.emit("note.updated", 6, {"marker": "live"})
            await send_request(client, 2, "ping", {})
            notification = await receive(client)
            response = await receive(client)
            assert notification == {
                "jsonrpc": "2.0",
                "method": "event",
                "params": {"type": "note.updated", "revision": 6, "data": {"marker": "live"}},
            }
            assert response["id"] == 2

    asyncio.run(scenario())


def test_events_are_delivered_while_a_request_is_pending() -> None:
    async def scenario() -> None:
        source = FakeEventSource()
        started = asyncio.Event()
        release = asyncio.Event()

        async def slow(args: Mapping[str, object]) -> object:
            started.set()
            await release.wait()
            return "done"

        commands = FakeInvoker({"note.slow": slow})
        async with connected(_handlers(source, commands)) as client:
            await send_request(client, 1, "event.subscribe", {"since": 0})
            assert (await receive(client))["result"] == {"revision": 0}
            await send_request(client, 2, "cmd.invoke", {"name": "note.slow"})
            await asyncio.wait_for(started.wait(), timeout=10)
            await source.emit("note.created", 1, {"marker": "live"})
            notification = await receive(client)
            assert notification["params"] == {
                "type": "note.created",
                "revision": 1,
                "data": {"marker": "live"},
            }
            release.set()
            assert (await receive(client))["id"] == 2

    asyncio.run(scenario())


def test_disconnect_unsubscribes_from_event_source() -> None:
    async def scenario() -> None:
        source = FakeEventSource()
        async with connected(_handlers(source)) as client:
            await send_request(client, 1, "event.subscribe", {"since": 0})
            assert (await receive(client))["result"] == {"revision": 0}
            assert source.listening == 1
        await asyncio.wait_for(source.unsubscribed.wait(), timeout=10)
        assert source.listening == 0

    asyncio.run(scenario())


def test_live_event_carries_owner_and_state_when_present() -> None:
    async def scenario() -> None:
        source = FakeEventSource()
        async with connected(_handlers(source)) as client:
            await send_request(client, 1, "event.subscribe", {"since": 0})
            assert (await receive(client))["result"] == {"revision": 0}
            await source.emit("note.updated", 1, {"id": "a"}, owner="notes", state={"items": []})
            notification = await receive(client)
            assert notification["params"] == {
                "type": "note.updated",
                "revision": 1,
                "data": {"id": "a"},
                "owner": "notes",
                "state": {"items": []},
            }

    asyncio.run(scenario())

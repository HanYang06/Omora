"""C1 请求分发：结果形状、并发 id 对应、错误码映射。"""

from __future__ import annotations

import asyncio
from collections.abc import Mapping
from typing import cast

from omora_kernel.context import UnavailableError
from omora_kernel.transport.ws import C1Handlers

from .support import (
    FakeEventSource,
    FakeInvoker,
    FakeSnapshots,
    connected,
    receive,
    send_request,
)


def _handlers(commands: FakeInvoker, queries: FakeInvoker, snapshots: FakeSnapshots) -> C1Handlers:
    return C1Handlers(
        commands=commands,
        queries=queries,
        snapshots=snapshots,
        events=FakeEventSource(),
    )


def _error(response: dict[str, object]) -> dict[str, object]:
    return cast("dict[str, object]", response["error"])


def test_snapshot_returns_revision_state_and_ui() -> None:
    async def scenario() -> None:
        snapshots = FakeSnapshots()
        snapshots.revision = 7
        snapshots.state = {"notes": [{"id": "a"}]}
        snapshots.ui = {"slots": {"main": [{"owner": "notes", "nodes": []}]}}
        async with connected(_handlers(FakeInvoker(), FakeInvoker(), snapshots)) as client:
            await send_request(client, 1, "state.snapshot", {})
            response = await receive(client)
            assert response == {
                "jsonrpc": "2.0",
                "id": 1,
                "result": {
                    "revision": 7,
                    "state": {"notes": [{"id": "a"}]},
                    "ui": {"slots": {"main": [{"owner": "notes", "nodes": []}]}},
                },
            }

    asyncio.run(scenario())


def test_command_returns_revision_and_handler_result() -> None:
    async def scenario() -> None:
        snapshots = FakeSnapshots()

        async def create(args: Mapping[str, object]) -> object:
            snapshots.revision += 1
            return {"id": "note-1", "title": args.get("title")}

        commands = FakeInvoker({"note.create": create})
        async with connected(_handlers(commands, FakeInvoker(), snapshots)) as client:
            await send_request(
                client,
                "req-1",
                "cmd.invoke",
                {"name": "note.create", "args": {"title": "第一条"}},
            )
            response = await receive(client)
            assert response == {
                "jsonrpc": "2.0",
                "id": "req-1",
                "result": {"revision": 1, "result": {"id": "note-1", "title": "第一条"}},
            }
            assert commands.calls == [("note.create", {"title": "第一条"})]

    asyncio.run(scenario())


def test_query_returns_items_and_cursor() -> None:
    async def scenario() -> None:
        async def page(args: Mapping[str, object]) -> object:
            return {"items": [{"id": "a"}, {"id": "b"}], "cursor": 3}

        async def empty(args: Mapping[str, object]) -> object:
            return {"items": []}

        queries = FakeInvoker({"note.list": page, "note.empty": empty})
        async with connected(_handlers(FakeInvoker(), queries, FakeSnapshots())) as client:
            await send_request(client, 2, "query.invoke", {"name": "note.list", "limit": 2})
            assert (await receive(client))["result"] == {
                "items": [{"id": "a"}, {"id": "b"}],
                "cursor": 3,
            }
            await send_request(client, 3, "query.invoke", {"name": "note.empty"})
            assert (await receive(client))["result"] == {"items": []}

    asyncio.run(scenario())


def test_ping_reports_current_revision() -> None:
    async def scenario() -> None:
        snapshots = FakeSnapshots()
        snapshots.revision = 42
        async with connected(_handlers(FakeInvoker(), FakeInvoker(), snapshots)) as client:
            await send_request(client, 4, "ping", {})
            assert (await receive(client))["result"] == {"revision": 42}

    asyncio.run(scenario())


def test_concurrent_requests_keep_ids_matched() -> None:
    async def scenario() -> None:
        released = asyncio.Event()

        async def slow(args: Mapping[str, object]) -> object:
            await released.wait()
            return "slow"

        async def fast(args: Mapping[str, object]) -> object:
            released.set()
            return "fast"

        commands = FakeInvoker({"note.slow": slow, "note.fast": fast})
        async with connected(_handlers(commands, FakeInvoker(), FakeSnapshots())) as client:
            await send_request(client, 1, "cmd.invoke", {"name": "note.slow"})
            await send_request(client, 2, "cmd.invoke", {"name": "note.fast"})
            first = await receive(client)
            second = await receive(client)
            assert first == {
                "jsonrpc": "2.0",
                "id": 2,
                "result": {"revision": 0, "result": "fast"},
            }
            assert second == {
                "jsonrpc": "2.0",
                "id": 1,
                "result": {"revision": 0, "result": "slow"},
            }

    asyncio.run(scenario())


def test_unavailable_error_maps_to_e_unavailable() -> None:
    async def scenario() -> None:
        async def unavailable(args: Mapping[str, object]) -> object:
            raise UnavailableError("note-store")

        commands = FakeInvoker({"note.open": unavailable})
        async with connected(_handlers(commands, FakeInvoker(), FakeSnapshots())) as client:
            await send_request(client, 5, "cmd.invoke", {"name": "note.open"})
            response = await receive(client)
            assert response["id"] == 5
            assert _error(response)["code"] == "E_UNAVAILABLE"

    asyncio.run(scenario())


def test_value_error_maps_to_e_invalid() -> None:
    async def scenario() -> None:
        async def invalid(args: Mapping[str, object]) -> object:
            raise ValueError("标题不能为空")

        commands = FakeInvoker({"note.create": invalid})
        async with connected(_handlers(commands, FakeInvoker(), FakeSnapshots())) as client:
            await send_request(client, 6, "cmd.invoke", {"name": "note.create"})
            response = await receive(client)
            assert _error(response) == {"code": "E_INVALID", "message": "标题不能为空"}

    asyncio.run(scenario())


def test_unexpected_error_maps_to_e_internal_without_leaking() -> None:
    async def scenario() -> None:
        async def boom(args: Mapping[str, object]) -> object:
            raise RuntimeError("secret-marker")

        commands = FakeInvoker({"note.boom": boom})
        async with connected(_handlers(commands, FakeInvoker(), FakeSnapshots())) as client:
            await send_request(client, 7, "cmd.invoke", {"name": "note.boom"})
            response = await receive(client)
            error = _error(response)
            assert error["code"] == "E_INTERNAL"
            assert error["message"] == "内部错误"
            assert "secret-marker" not in str(response)
            assert "Traceback" not in str(response)
            await send_request(client, 8, "ping", {})
            assert (await receive(client))["id"] == 8

    asyncio.run(scenario())


def test_malformed_query_result_maps_to_e_internal() -> None:
    async def scenario() -> None:
        async def broken(args: Mapping[str, object]) -> object:
            return {"items": "not-a-list"}

        queries = FakeInvoker({"note.list": broken})
        async with connected(_handlers(FakeInvoker(), queries, FakeSnapshots())) as client:
            await send_request(client, 9, "query.invoke", {"name": "note.list"})
            assert _error(await receive(client))["code"] == "E_INTERNAL"

    asyncio.run(scenario())

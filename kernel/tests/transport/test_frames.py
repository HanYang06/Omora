"""入站帧校验：非法帧回 E_INVALID，且连接保持可用。"""

from __future__ import annotations

import asyncio
from typing import cast

from .support import (
    connected,
    make_handlers,
    receive,
    send_raw,
    send_request,
)


def _error(response: dict[str, object]) -> dict[str, object]:
    return cast("dict[str, object]", response["error"])


def test_invalid_json_gets_e_invalid_and_connection_survives() -> None:
    async def scenario() -> None:
        async with connected(make_handlers()) as client:
            await send_raw(client, "not-json")
            response = await receive(client)
            assert response == {
                "jsonrpc": "2.0",
                "id": None,
                "error": {"code": "E_INVALID", "message": "帧不是合法 JSON"},
            }
            await send_request(client, 1, "ping", {})
            assert (await receive(client))["id"] == 1

    asyncio.run(scenario())


def test_schema_violation_keeps_request_id() -> None:
    async def scenario() -> None:
        async with connected(make_handlers()) as client:
            await send_request(client, 7, "cmd.invoke", {"args": {}})
            response = await receive(client)
            assert response["id"] == 7
            assert _error(response)["code"] == "E_INVALID"

    asyncio.run(scenario())


def test_unknown_method_is_rejected() -> None:
    async def scenario() -> None:
        async with connected(make_handlers()) as client:
            await send_request(client, 8, "note.unknown", {})
            response = await receive(client)
            assert _error(response) == {
                "code": "E_INVALID",
                "message": "未知方法: note.unknown",
            }

    asyncio.run(scenario())


def test_unknown_param_field_is_rejected() -> None:
    async def scenario() -> None:
        async with connected(make_handlers()) as client:
            await send_request(client, 9, "ping", {"extra": True})
            response = await receive(client)
            assert response["id"] == 9
            assert _error(response)["code"] == "E_INVALID"

    asyncio.run(scenario())


def test_non_object_frame_gets_null_id() -> None:
    async def scenario() -> None:
        async with connected(make_handlers()) as client:
            await send_raw(client, "[]")
            response = await receive(client)
            assert response["id"] is None
            assert _error(response)["code"] == "E_INVALID"

    asyncio.run(scenario())


def test_request_without_id_gets_null_id() -> None:
    async def scenario() -> None:
        async with connected(make_handlers()) as client:
            await send_raw(client, '{"jsonrpc": "2.0", "method": "ping", "params": {}}')
            response = await receive(client)
            assert response["id"] is None
            assert _error(response)["code"] == "E_INVALID"

    asyncio.run(scenario())

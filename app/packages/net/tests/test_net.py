import asyncio
import json
from typing import Any

from websockets.asyncio.client import connect

from omora.core.context import Context
from omora.net import Net


class _Echo:
    def ping(self) -> str:
        return "pong"

    def boom(self) -> None:
        raise RuntimeError("炸了")


def _net(port: int = 0) -> Net:
    ctx = Context()
    ctx.provide("svc", _Echo())
    return Net(ctx, port=port)


def _call(frame_id: str, service: str, method: str, **args: Any) -> dict[str, Any]:
    return {"id": frame_id, "type": "call", "target": service, "method": method, "args": args}


def test_a_call_reaches_the_service_and_comes_back_as_a_result() -> None:
    frame = _net().handle(_call("1", "svc", "ping"))

    assert frame == {"id": "1", "type": "result", "value": "pong"}


def test_unknown_service_is_unknown_target() -> None:
    frame = _net().handle(_call("1", "nope", "ping"))

    assert (frame["type"], frame["code"]) == ("error", "unknown_target")


def test_unknown_method_is_unknown_method() -> None:
    frame = _net().handle(_call("1", "svc", "nope"))

    assert (frame["type"], frame["code"]) == ("error", "unknown_method")


def test_a_service_failure_is_call_failed_with_its_message() -> None:
    frame = _net().handle(_call("1", "svc", "boom"))

    assert (frame["type"], frame["code"], frame["message"]) == ("error", "call_failed", "炸了")


def test_a_malformed_frame_keeps_the_id_when_it_can() -> None:
    frame = _net().handle({"id": "9", "type": "nope"})

    assert (frame["id"], frame["code"]) == ("9", "bad_frame")


def test_a_frame_without_id_comes_back_with_a_null_id() -> None:
    frame = _net().handle({"type": "call"})

    assert (frame["id"], frame["code"]) == (None, "bad_frame")


def test_a_real_client_gets_a_result_over_the_socket() -> None:
    async def scenario() -> dict[str, Any]:
        net = _net()
        port = await net.serve()
        try:
            async with connect(f"ws://127.0.0.1:{port}") as ws:
                await ws.send(json.dumps(_call("1", "svc", "ping")))
                reply: dict[str, Any] = json.loads(await ws.recv())
                return reply
        finally:
            await net.stop()

    frame = asyncio.run(scenario())

    assert frame == {"id": "1", "type": "result", "value": "pong"}

import asyncio
import io
import json
from typing import Any

import pytest
from websockets.asyncio.client import connect

from omora.core.context import Context
from omora.core.log import build_log
from omora.net import Net, _decode
from omora.sdk.protocol import FrameError
from omora.sdk.realtime import emit


class _Echo:
    """测试服务：一个正常方法、一个抛错的方法、一个分发期间 emit 的方法。"""

    def __init__(self, ctx: Context) -> None:
        self.ctx = ctx
        self.called = asyncio.Event()

    def ping(self) -> str:
        self.called.set()
        return "pong"

    def boom(self) -> None:
        raise RuntimeError("炸了")

    def push(self) -> str:
        emit(self.ctx, "ui.snapshot", {"version": 9})
        emit(self.ctx, "media.progress", {"percent": 40.0})
        return "ok"


class _Gate:
    """挡住 net 发字节的边界：测试里用来把队列压满。"""

    def __init__(self) -> None:
        self.open = True
        self.entered = asyncio.Event()
        self.release = asyncio.Event()

    async def __call__(self, ws: Any, text: str) -> None:
        if not self.open:
            self.entered.set()
            await self.release.wait()
        await ws.send(text)


def _net(port: int = 0, *, ctx: Context | None = None, **kwargs: Any) -> Net:
    ctx = Context() if ctx is None else ctx
    net = Net(ctx, port=port, **kwargs)
    ctx.provide("net", net)
    ctx.provide("svc", _Echo(ctx))
    return net


def _url(port: int) -> str:
    return f"ws://127.0.0.1:{port}"


def _call_frame(frame_id: str, service: str, method: str, **args: Any) -> dict[str, Any]:
    return {"id": frame_id, "type": "call", "target": service, "method": method, "args": args}


async def _send_call(ws: Any, frame_id: str, service: str, method: str, **args: Any) -> None:
    await ws.send(json.dumps(_call_frame(frame_id, service, method, **args)))


async def _send_raw(ws: Any, frame: dict[str, Any]) -> None:
    await ws.send(json.dumps(frame))


async def _recv(ws: Any) -> dict[str, Any]:
    frame: dict[str, Any] = json.loads(await ws.recv())
    return frame


# ---- 基本分发（不经过 socket）------------------------------------------


def test_a_call_reaches_the_service_and_comes_back_as_a_result() -> None:
    frame = _net().handle(_call_frame("1", "svc", "ping"))

    assert frame == {"id": "1", "type": "result", "value": "pong"}


def test_unknown_service_is_unknown_target() -> None:
    frame = _net().handle(_call_frame("1", "nope", "ping"))

    assert (frame["type"], frame["code"]) == ("error", "unknown_target")


def test_unknown_method_is_unknown_method() -> None:
    frame = _net().handle(_call_frame("1", "svc", "nope"))

    assert (frame["type"], frame["code"]) == ("error", "unknown_method")


def test_a_service_failure_is_call_failed_with_its_message() -> None:
    frame = _net().handle(_call_frame("1", "svc", "boom"))

    assert (frame["type"], frame["code"], frame["message"]) == ("error", "call_failed", "炸了")


def test_a_malformed_frame_keeps_the_id_when_it_can() -> None:
    frame = _net().handle({"id": "9", "type": "nope"})

    assert (frame["id"], frame["code"]) == ("9", "bad_frame")


def test_a_frame_without_id_comes_back_with_a_null_id() -> None:
    frame = _net().handle({"type": "call"})

    assert (frame["id"], frame["code"]) == (None, "bad_frame")


def test_a_binary_frame_is_rejected() -> None:
    with pytest.raises(FrameError, match="文本帧"):
        _decode(b"{}")


def test_a_non_json_frame_is_rejected() -> None:
    with pytest.raises(FrameError, match="JSON"):
        _decode("{")


# ---- 走真实 ws 客户端 -------------------------------------------------


def test_a_real_client_gets_a_result_over_the_socket() -> None:
    async def scenario() -> dict[str, Any]:
        net = _net()
        port = await net.serve()
        try:
            async with connect(_url(port)) as ws:
                await _send_call(ws, "1", "svc", "ping")
                return await _recv(ws)
        finally:
            await net.stop()

    assert asyncio.run(scenario()) == {"id": "1", "type": "result", "value": "pong"}


def test_a_bad_json_frame_gets_an_error_frame() -> None:
    async def scenario() -> dict[str, Any]:
        net = _net()
        port = await net.serve()
        try:
            async with connect(_url(port)) as ws:
                await ws.send("{")
                return await _recv(ws)
        finally:
            await net.stop()

    frame = asyncio.run(scenario())

    assert (frame["type"], frame["code"]) == ("error", "bad_frame")


def test_only_subscribed_topics_are_pushed() -> None:
    async def scenario() -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
        net = _net()
        port = await net.serve()
        try:
            async with connect(_url(port)) as ws:
                await _send_call(ws, "1", "net", "subscribe", topics=["ui.snapshot"])
                subscribed = await _recv(ws)
                net.emit("ui.snapshot", {"version": 8})
                net.emit("media.progress", {"percent": 10.0})
                pushed = await _recv(ws)
                return subscribed, pushed, net.stats()
        finally:
            await net.stop()

    subscribed, pushed, stats = asyncio.run(scenario())

    assert subscribed == {
        "id": "1",
        "type": "result",
        "value": {"topics": ["ui.snapshot"]},
    }
    assert pushed == {"type": "event", "topic": "ui.snapshot", "payload": {"version": 8}}
    # frames_out 只有订阅的 result 和这一条 event：media.progress 根本没进队列。
    assert stats["frames_out"] == 2
    assert stats["queue_depth"] == 0


def test_subscribe_keeps_first_order_and_is_idempotent() -> None:
    async def scenario() -> list[dict[str, Any]]:
        net = _net()
        port = await net.serve()
        try:
            async with connect(_url(port)) as ws:
                await _send_call(ws, "1", "net", "subscribe", topics=["b", "a", "b"])
                first = await _recv(ws)
                await _send_call(ws, "2", "net", "subscribe", topics=["a"])
                again = await _recv(ws)
                return [first, again]
        finally:
            await net.stop()

    first, again = asyncio.run(scenario())

    assert first["value"] == {"topics": ["b", "a"]}
    assert again["value"] == {"topics": ["b", "a"]}


def test_unsubscribe_reports_the_remaining_topics() -> None:
    async def scenario() -> dict[str, Any]:
        net = _net()
        port = await net.serve()
        try:
            async with connect(_url(port)) as ws:
                await _send_call(ws, "1", "net", "subscribe", topics=["b", "a", "c"])
                await _recv(ws)
                await _send_call(ws, "2", "net", "unsubscribe", topics=["b"])
                return await _recv(ws)
        finally:
            await net.stop()

    frame = asyncio.run(scenario())

    assert frame["value"] == {"topics": ["a", "c"]}


def test_subscribing_a_topic_nobody_emits_is_not_an_error() -> None:
    async def scenario() -> dict[str, Any]:
        net = _net()
        port = await net.serve()
        try:
            async with connect(_url(port)) as ws:
                await _send_call(ws, "1", "net", "subscribe", topics=["nope"])
                return await _recv(ws)
        finally:
            await net.stop()

    frame = asyncio.run(scenario())

    # 没有 unknown 字段：订阅总是成功；没有生产者就永远收不到东西。
    assert frame == {"id": "1", "type": "result", "value": {"topics": ["nope"]}}


def test_subscribe_rejects_args_topics_that_are_not_non_empty_strings() -> None:
    async def scenario() -> list[dict[str, Any]]:
        net = _net()
        port = await net.serve()
        try:
            async with connect(_url(port)) as ws:
                replies: list[dict[str, Any]] = []
                bad_args: list[dict[str, Any]] = [
                    {},
                    {"topics": "ui.snapshot"},
                    {"topics": [""]},
                    {"topics": [1]},
                ]
                for index, args in enumerate(bad_args):
                    await _send_raw(
                        ws,
                        {
                            "id": str(index),
                            "type": "call",
                            "target": "net",
                            "method": "subscribe",
                            "args": args,
                        },
                    )
                    replies.append(await _recv(ws))
                return replies
        finally:
            await net.stop()

    replies = asyncio.run(scenario())

    assert [(frame["type"], frame["code"]) for frame in replies] == [("error", "bad_frame")] * 4


def test_events_emitted_during_a_call_come_after_its_result() -> None:
    async def scenario() -> list[dict[str, Any]]:
        net = _net()
        port = await net.serve()
        try:
            async with connect(_url(port)) as ws:
                await _send_call(
                    ws, "1", "net", "subscribe", topics=["ui.snapshot", "media.progress"]
                )
                await _recv(ws)
                await _send_call(ws, "2", "svc", "push")
                return [await _recv(ws), await _recv(ws), await _recv(ws)]
        finally:
            await net.stop()

    first, second, third = asyncio.run(scenario())

    assert first == {"id": "2", "type": "result", "value": "ok"}
    assert second == {"type": "event", "topic": "ui.snapshot", "payload": {"version": 9}}
    assert third == {"type": "event", "topic": "media.progress", "payload": {"percent": 40.0}}


def test_coalesce_replaces_the_queued_message_for_the_same_topic() -> None:
    async def scenario() -> tuple[dict[str, Any], dict[str, Any]]:
        net = _net()
        port = await net.serve()
        try:
            async with connect(_url(port)) as ws:
                await _send_call(ws, "1", "net", "subscribe", topics=["progress"])
                await _recv(ws)
                net.emit("progress", {"n": 1}, coalesce=True)
                net.emit("progress", {"n": 2}, coalesce=True)
                return await _recv(ws), net.stats()
        finally:
            await net.stop()

    frame, stats = asyncio.run(scenario())

    assert frame == {"type": "event", "topic": "progress", "payload": {"n": 2}}
    # 订阅 result + 一条（旧的被替换掉，没有第二条）。
    assert stats["frames_out"] == 2


def test_events_without_coalesce_are_all_kept() -> None:
    async def scenario() -> list[dict[str, Any]]:
        net = _net()
        port = await net.serve()
        try:
            async with connect(_url(port)) as ws:
                await _send_call(ws, "1", "net", "subscribe", topics=["progress"])
                await _recv(ws)
                net.emit("progress", {"n": 1})
                net.emit("progress", {"n": 2})
                return [await _recv(ws), await _recv(ws)]
        finally:
            await net.stop()

    first, second = asyncio.run(scenario())

    assert first["payload"] == {"n": 1}
    assert second["payload"] == {"n": 2}


def test_a_full_queue_answers_overloaded_and_drops_events() -> None:
    async def scenario() -> tuple[list[dict[str, Any]], dict[str, Any]]:
        gate = _Gate()
        ctx = Context()
        service = _Echo(ctx)
        net = Net(ctx, port=0, max_queue=2, writer=gate)
        ctx.provide("net", net)
        ctx.provide("svc", service)
        port = await net.serve()
        try:
            async with connect(_url(port)) as ws:
                await _send_call(ws, "1", "net", "subscribe", topics=["t"])
                await _recv(ws)
                gate.open = False
                net.emit("t", {"n": 1})
                net.emit("t", {"n": 2})
                net.emit("t", {"n": 3})  # 队列满：丢掉并计数
                await gate.entered.wait()  # 发送任务卡在第一条上，队列仍是满的
                await _send_call(ws, "2", "svc", "ping")
                await service.called.wait()  # 分发已经跑完、result 已经换成 overloaded
                gate.release.set()
                replies = [await _recv(ws), await _recv(ws)]
                return replies, net.stats()
        finally:
            await net.stop()

    replies, stats = asyncio.run(scenario())

    assert replies[0] == {"type": "event", "topic": "t", "payload": {"n": 1}}
    assert (replies[1]["id"], replies[1]["code"]) == ("2", "overloaded")
    assert stats["dropped"] == 2  # 一条 emit 时丢掉，一条给 overloaded 腾位置
    assert stats["calls"] == 2
    assert stats["frames_out"] == 3  # 订阅 result + 一条 event + overloaded


def test_stats_reports_calls_frames_and_bytes() -> None:
    async def scenario() -> tuple[dict[str, Any], dict[str, Any]]:
        net = _net()
        port = await net.serve()
        try:
            async with connect(_url(port)) as ws:
                await _send_call(ws, "1", "svc", "ping")
                first = await _recv(ws)
                await _send_call(ws, "2", "net", "stats")
                return first, await _recv(ws)
        finally:
            await net.stop()

    first, second = asyncio.run(scenario())

    assert first == {"id": "1", "type": "result", "value": "pong"}
    value = second["value"]
    assert value["connections"] == 1
    assert value["calls"] == 2
    assert value["frames_out"] == 1
    assert value["bytes_out"] == len(json.dumps(first, ensure_ascii=False).encode("utf-8"))
    assert value["queue_depth"] == 0
    assert value["dropped"] == 0
    assert value["slow_calls"] == []


def test_emit_without_a_connection_is_dropped() -> None:
    net = _net()
    net.emit("ui.snapshot", {"version": 1})

    async def scenario() -> dict[str, Any]:
        port = await net.serve()
        try:
            async with connect(_url(port)) as ws:
                await _send_call(ws, "1", "net", "subscribe", topics=["ui.snapshot"])
                await _recv(ws)
                return net.stats()
        finally:
            await net.stop()

    stats = asyncio.run(scenario())

    # 只有订阅的 result；serve 之前 emit 的那条没有留在任何地方。
    assert stats["frames_out"] == 1


def test_emit_from_another_thread_reaches_the_client() -> None:
    async def scenario() -> dict[str, Any]:
        net = _net()
        port = await net.serve()
        try:
            async with connect(_url(port)) as ws:
                await _send_call(ws, "1", "net", "subscribe", topics=["t"])
                await _recv(ws)
                await asyncio.to_thread(net.emit, "t", {"n": 1})
                return await _recv(ws)
        finally:
            await net.stop()

    frame = asyncio.run(scenario())

    assert frame == {"type": "event", "topic": "t", "payload": {"n": 1}}


def test_emit_rejects_a_topic_or_payload_that_is_not_an_object() -> None:
    net = _net()

    with pytest.raises(ValueError, match="topic"):
        net.emit("", {})
    with pytest.raises(ValueError, match="payload"):
        net.emit("t", [])  # type: ignore[arg-type]


def test_a_slow_call_is_recorded_and_warned() -> None:
    async def scenario() -> tuple[dict[str, Any], str]:
        stream = io.StringIO()
        log = build_log(stream=stream)
        ctx = Context(log=log)
        times = iter([100.0, 100.025])
        net = Net(ctx, port=0, clock=lambda: next(times))
        ctx.provide("net", net)
        ctx.provide("svc", _Echo(ctx))
        port = await net.serve()
        try:
            async with connect(_url(port)) as ws:
                await _send_call(ws, "1", "svc", "ping")
                await _recv(ws)
                return net.stats(), stream.getvalue()
        finally:
            await net.stop()

    stats, written = asyncio.run(scenario())

    assert stats["slow_calls"] == [{"target": "svc", "method": "ping", "ms": 25.0}]
    assert "net.slow_call" in written
    assert "target=svc" in written
    assert "method=ping" in written


def test_a_fast_call_is_not_a_slow_call() -> None:
    times = iter([100.0, 100.004])
    net = _net(clock=lambda: next(times))

    frame = net.handle(_call_frame("1", "svc", "ping"))

    assert frame["value"] == "pong"
    assert net.stats()["slow_calls"] == []


def test_serve_stops_when_the_media_channel_cannot_start(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def scenario() -> None:
        net = _net()

        async def fail() -> int:
            raise OSError("busy")

        monkeypatch.setattr(net._media, "start", fail)
        with pytest.raises(OSError, match="busy"):
            await net.serve()
        assert net.media_url is None

    asyncio.run(scenario())

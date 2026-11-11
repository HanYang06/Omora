import asyncio
import io
import json
from typing import Any

import pytest
from websockets.asyncio.client import connect

from omora.core.context import Context
from omora.core.log import build_log
from omora.net import Net
from omora.sdk.realtime import emit


class _Echo:
    """测试服务：ping 会通知测试，push 在分发期间 emit 两条事件。"""

    def __init__(self, ctx: Context) -> None:
        self.ctx = ctx
        self.called = asyncio.Event()

    def ping(self) -> str:
        self.called.set()
        return "pong"

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


async def _call_and_wait(ws: Any, service: _Echo, frame_id: str) -> None:
    """发一次 ping，并等它真的分发到服务（入队紧跟在这一步之后）。"""
    service.called = asyncio.Event()
    await _send_call(ws, frame_id, "svc", "ping")
    await service.called.wait()


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


def test_an_event_that_does_not_fit_the_queue_is_dropped_and_counted() -> None:
    async def scenario() -> tuple[dict[str, Any], dict[str, Any]]:
        gate = _Gate()
        ctx = Context()
        net = Net(ctx, port=0, max_queue=1, writer=gate)
        ctx.provide("net", net)
        port = await net.serve()
        try:
            async with connect(_url(port)) as ws:
                await _send_call(ws, "1", "net", "subscribe", topics=["t"])
                await _recv(ws)
                gate.open = False
                net.emit("t", {"n": 1})
                await gate.entered.wait()  # 第一条已经占住唯一的队列位置
                net.emit("t", {"n": 2})  # 放不下：丢弃并计数
                gate.release.set()
                pushed = await _recv(ws)
                return pushed, net.stats()
        finally:
            await net.stop()

    pushed, stats = asyncio.run(scenario())

    assert pushed == {"type": "event", "topic": "t", "payload": {"n": 1}}
    assert stats["dropped"] == 1
    assert stats["frames_out"] == 2  # 订阅 result + 留下的那条 event


def test_a_full_queue_drops_an_event_but_still_delivers_the_result() -> None:
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
                net.emit("t", {"n": 2})  # 队列被 event 压满
                await gate.entered.wait()  # 发送任务卡在第一条上
                await _call_and_wait(ws, service, "2")
                gate.release.set()
                replies = [await _recv(ws), await _recv(ws)]
                return replies, net.stats()
        finally:
            await net.stop()

    replies, stats = asyncio.run(scenario())

    assert replies[0] == {"type": "event", "topic": "t", "payload": {"n": 1}}
    # 回帧优先于 event：丢一条待发 event 腾位置，正常调用不会拿到 overloaded。
    assert replies[1] == {"id": "2", "type": "result", "value": "pong"}
    assert stats["dropped"] == 1
    assert stats["frames_out"] == 3  # 订阅 result + 一条 event + 调用 result


def test_overloaded_only_happens_when_no_event_can_be_dropped() -> None:
    async def scenario() -> tuple[list[dict[str, Any]], dict[str, Any]]:
        gate = _Gate()
        ctx = Context()
        service = _Echo(ctx)
        net = Net(ctx, port=0, max_queue=1, writer=gate)
        ctx.provide("net", net)
        ctx.provide("svc", service)
        port = await net.serve()
        try:
            async with connect(_url(port)) as ws:
                await _send_call(ws, "1", "net", "subscribe", topics=["t"])
                await _recv(ws)
                gate.open = False
                await _call_and_wait(ws, service, "2")  # 回帧卡在队列里，发不出去
                await _call_and_wait(ws, service, "3")  # 没有 event 可丢 → overloaded
                gate.release.set()
                replies = [await _recv(ws), await _recv(ws)]
                return replies, net.stats()
        finally:
            await net.stop()

    replies, stats = asyncio.run(scenario())

    assert replies[0] == {"id": "2", "type": "result", "value": "pong"}
    assert (replies[1]["id"], replies[1]["code"]) == ("3", "overloaded")
    assert stats["dropped"] == 0  # 没有任何 event 被丢


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

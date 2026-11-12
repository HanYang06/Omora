"""net：WebSocket + 帧分发 + 订阅与指标。

协议的形状是合同（见 docs/design/protocol.md），这里负责把它搬起来：
收帧、解析、找服务、调用、回帧、订阅、指标。每连接的发送队列在
_outbox.py：net 负责分发，outbox 负责排队与写出去。
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import time
from collections.abc import Callable
from typing import Any

from websockets.asyncio.server import Server, ServerConnection
from websockets.asyncio.server import serve as ws_serve

from omora.sdk import Context
from omora.sdk.protocol import (
    BAD_FRAME,
    CALL_FAILED,
    UNKNOWN_METHOD,
    UNKNOWN_TARGET,
    FrameError,
    error_frame,
    parse_call,
    result_frame,
)

from ._outbox import DEFAULT_QUEUE_MAX, Counters, Frame, Outbox, Writer
from .media_http import MediaHttp

DEFAULT_ORIGINS = ("http://127.0.0.1:5173", "http://localhost:5173")
SLOW_CALL_MS = 10.0
MAX_SLOW_CALLS = 50


class Net:
    """帧进来，帧出去。服务方法全是同步的，所以分发天然串行；发送走 _outbox。"""

    def __init__(  # noqa: PLR0913 —— 声明式的服务装配参数
        self,
        ctx: Context,
        host: str = "127.0.0.1",
        port: int = 8765,
        *,
        media_port: int = 0,
        media_origins: tuple[str, ...] = DEFAULT_ORIGINS,
        max_queue: int = DEFAULT_QUEUE_MAX,
        clock: Callable[[], float] | None = None,
        writer: Writer | None = None,
    ) -> None:
        if max_queue < 0:
            raise ValueError("max_queue 不能为负")
        self.host = host
        self.port = port
        self._ctx = ctx
        self._server: Server | None = None
        self._log = ctx.log
        self._media = MediaHttp(ctx, host=host, port=media_port, origins=media_origins)
        self._max_queue = max_queue
        self._clock: Callable[[], float] = time.perf_counter if clock is None else clock
        self._writer: Writer = _send_text if writer is None else writer
        self._loop: asyncio.AbstractEventLoop | None = None
        self._connections: list[Outbox] = []
        self._call_lock = asyncio.Lock()
        self._counters = Counters()
        self._current: Outbox | None = None
        self._defer = 0
        self._pending: list[tuple[str, dict[str, Any], bool]] = []
        self._calls = 0
        self._slow_calls: list[dict[str, Any]] = []

    @property
    def media_url(self) -> str | None:
        """HTTP 媒体通道的地址；没起就是 None。视频插件按它决定能不能出捕捉条。"""
        return self._media.url

    # ---- 推送 ---------------------------------------------------------

    def emit(self, topic: str, payload: dict[str, Any], *, coalesce: bool = False) -> None:
        """把一个事件交给连接；同步、非阻塞。没有连接就丢弃。"""
        if not isinstance(topic, str) or not topic:
            raise ValueError("topic 必须是非空字符串")
        if not isinstance(payload, dict):
            raise ValueError("payload 必须是对象")
        loop = self._loop
        if loop is None:
            return
        try:
            running = asyncio.get_running_loop()
        except RuntimeError:
            running = None
        if running is loop:
            self._deliver(topic, payload, coalesce)
            return
        with contextlib.suppress(RuntimeError):
            loop.call_soon_threadsafe(self._deliver, topic, payload, coalesce)

    def _deliver(self, topic: str, payload: dict[str, Any], coalesce: bool) -> None:
        # 一次 call 分发期间发出的事件先缓冲：客户端要先拿到 result，才能应用补丁。
        if self._defer > 0:
            self._pending.append((topic, payload, coalesce))
            return
        self._broadcast(topic, payload, coalesce)

    def _broadcast(self, topic: str, payload: dict[str, Any], coalesce: bool) -> None:
        for conn in self._connections:
            if conn.closed or not conn.wants(topic):
                continue
            if conn.push_event(topic, payload, coalesce):
                self._log.trace("net.dropped", topic=topic)

    def _flush_pending(self) -> None:
        if not self._pending:
            return
        pending, self._pending = self._pending, []
        for topic, payload, coalesce in pending:
            self._broadcast(topic, payload, coalesce)

    # ---- 订阅 ---------------------------------------------------------

    def subscribe(self, topics: object = None) -> dict[str, list[str]]:
        """把 topics 挂到当前连接上；任何非空字符串都接受，不判断认不认识。"""
        names = _parse_topics(topics)
        conn = self._current
        if conn is None:
            return {"topics": []}
        conn.subscribe(names)
        return {"topics": conn.topic_list()}

    def unsubscribe(self, topics: object = None) -> dict[str, list[str]]:
        """把 topics 从当前连接上摘掉；回剩下的列表。"""
        names = _parse_topics(topics)
        conn = self._current
        if conn is None:
            return {"topics": []}
        conn.unsubscribe(names)
        return {"topics": conn.topic_list()}

    # ---- 指标 ---------------------------------------------------------

    def stats(self) -> dict[str, Any]:
        """协议 §8 的字段。开发面板与日志读它，不靠感觉。"""
        return {
            "connections": len(self._connections),
            "calls": self._calls,
            "frames_out": self._counters.frames_out,
            "bytes_out": self._counters.bytes_out,
            "queue_depth": sum(len(conn.queue) for conn in self._connections),
            "dropped": self._counters.dropped,
            "slow_calls": list(self._slow_calls),
        }

    # ---- 分发 ---------------------------------------------------------

    def handle(self, raw: object) -> Frame:
        """一帧进，一帧出，同步旧路径（只有测试直接调）。正式入口是 _dispatch。"""
        frame = self._call(raw, None)
        self._flush_pending()
        return frame

    def _call(self, raw: object, conn: Outbox | None) -> Frame:
        started = self._clock()
        frame, target, method = self._perform(raw, conn)
        if target is None:
            return frame
        ms = (self._clock() - started) * 1000
        if ms > SLOW_CALL_MS:
            entry: dict[str, Any] = {"target": target, "method": method, "ms": round(ms, 1)}
            self._slow_calls.append(entry)
            del self._slow_calls[:-MAX_SLOW_CALLS]
            self._log.warning("net.slow_call", target=target, method=method, ms=entry["ms"])
        return frame

    def _perform(self, raw: object, conn: Outbox | None) -> tuple[Frame, str | None, str | None]:
        try:
            call = parse_call(raw)
        except FrameError as exc:
            return error_frame(exc.frame_id, exc.code, str(exc)), None, None

        self._calls += 1
        try:
            service = self._ctx.resolve(call.target)
        except LookupError as exc:
            return error_frame(call.id, UNKNOWN_TARGET, str(exc)), call.target, call.method

        method = getattr(service, call.method, None)
        if method is None or not callable(method):
            return (
                error_frame(call.id, UNKNOWN_METHOD, f"{call.target} 没有方法 {call.method}"),
                call.target,
                call.method,
            )

        previous = self._current
        self._current = conn
        self._defer += 1
        try:
            value: Any = method(**call.args)
        except FrameError as exc:
            return error_frame(call.id, exc.code, str(exc)), call.target, call.method
        except Exception as exc:
            self._log.warning(
                "net.call.failed", target=call.target, method=call.method, err=type(exc).__name__
            )
            return error_frame(call.id, CALL_FAILED, str(exc)), call.target, call.method
        finally:
            self._defer -= 1
            self._current = previous
        self._log.trace("net.call", target=call.target, method=call.method)
        return result_frame(call.id, value), call.target, call.method

    async def _dispatch(self, conn: Outbox, raw: object) -> None:
        async with self._call_lock:
            frame = self._call(raw, conn)
            conn.enqueue_reply(frame)
            self._flush_pending()

    # ---- 连接与生命周期 -----------------------------------------------

    async def serve(self) -> int:
        """起两件事：帧通道（WS）与 HTTP 媒体通道；返回 WS 端口。"""
        self._loop = asyncio.get_running_loop()
        self._server = await ws_serve(self._connection, self.host, self.port)
        try:
            await self._media.start()
        except OSError:
            await self.stop()
            raise
        sockets = self._server.sockets
        if not sockets:
            raise RuntimeError("net 起来了但没有监听端口")
        return int(next(iter(sockets)).getsockname()[1])

    async def stop(self) -> None:
        self._loop = None
        await self._media.stop()
        if self._server is not None:
            self._server.close()
            await self._server.wait_closed()
            self._server = None

    async def _connection(self, ws: ServerConnection) -> None:
        conn = Outbox(ws, max_queue=self._max_queue, counters=self._counters)
        self._connections.append(conn)
        self._log.debug("net.connected")
        send_task = asyncio.create_task(conn.run(self._writer))
        dispatches: set[asyncio.Task[None]] = set()
        try:
            async for message in ws:
                try:
                    raw = _decode(message)
                except FrameError as exc:
                    conn.enqueue_reply(error_frame(None, exc.code, str(exc)))
                    continue
                task = asyncio.create_task(self._dispatch(conn, raw))
                dispatches.add(task)
                task.add_done_callback(dispatches.discard)
        finally:
            conn.closed = True
            conn.wakeup.set()
            send_task.cancel()
            for task in list(dispatches):
                task.cancel()
            await asyncio.gather(send_task, *dispatches, return_exceptions=True)
            if conn in self._connections:
                self._connections.remove(conn)
            self._log.debug("net.disconnected")


class NetPlugin:
    name = "net"

    def __init__(
        self,
        host: str = "127.0.0.1",
        port: int | str = 8765,
        media_port: int | str = 0,
        media_origins: str = ",".join(DEFAULT_ORIGINS),
    ) -> None:
        self.host = str(host)
        self.port = int(port)
        self.media_port = int(media_port)
        self.media_origins = tuple(
            origin.strip() for origin in str(media_origins).split(",") if origin.strip()
        )

    def apply(self, ctx: Context) -> None:
        ctx.provide(
            "net",
            Net(
                ctx,
                self.host,
                self.port,
                media_port=self.media_port,
                media_origins=self.media_origins,
            ),
        )


def _parse_topics(value: object) -> list[str]:
    if not isinstance(value, list):
        raise FrameError(BAD_FRAME, "topics 必须是非空字符串组成的数组")
    names: list[str] = []
    for item in value:
        if not isinstance(item, str) or not item:
            raise FrameError(BAD_FRAME, "topics 必须是非空字符串组成的数组")
        names.append(item)
    return names


def _decode(message: str | bytes) -> object:
    if isinstance(message, bytes):
        raise FrameError(BAD_FRAME, "只收文本帧")
    try:
        return json.loads(message)
    except ValueError as exc:
        raise FrameError(BAD_FRAME, f"不是合法 JSON: {exc}") from exc


async def _send_text(ws: ServerConnection, text: str) -> None:
    await ws.send(text)


__all__ = ["DEFAULT_ORIGINS", "DEFAULT_QUEUE_MAX", "Net", "NetPlugin"]

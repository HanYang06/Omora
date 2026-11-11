"""net：WebSocket + 帧分发 + 有界发送队列。

协议的形状是合同（见 docs/design/protocol.md），这里负责把它搬起来：
收帧、解析、找服务、调用、回帧，以及每连接一条发送任务与有界队列。
分发是串行的（一把锁）；推送不进锁，走队列。
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import time
from collections import deque
from collections.abc import Awaitable, Callable
from typing import Any

from websockets.asyncio.server import Server, ServerConnection
from websockets.asyncio.server import serve as ws_serve
from websockets.exceptions import ConnectionClosed

from omora.sdk import Context
from omora.sdk.protocol import (
    BAD_FRAME,
    CALL_FAILED,
    EVENT,
    OVERLOADED,
    UNKNOWN_METHOD,
    UNKNOWN_TARGET,
    FrameError,
    error_frame,
    event_frame,
    parse_call,
    result_frame,
)

from .media_http import MediaHttp

DEFAULT_ORIGINS = ("http://127.0.0.1:5173", "http://localhost:5173")
DEFAULT_QUEUE_MAX = 256
SLOW_CALL_MS = 10.0
MAX_SLOW_CALLS = 50

Frame = dict[str, Any]
Writer = Callable[[ServerConnection, str], Awaitable[None]]


class _Connection:
    """一条连接自己的订阅表与发送队列。断开即随对象一起消失。"""

    def __init__(self, ws: ServerConnection) -> None:
        self.ws = ws
        self.topics: dict[str, None] = {}
        self.queue: deque[Frame] = deque()
        self.wakeup = asyncio.Event()
        self.sending: Frame | None = None
        self.closed = False

    def topic_list(self) -> list[str]:
        return list(self.topics)


class Net:
    """帧进来，帧出去。服务方法全是同步的，所以分发天然串行；发送另有一条任务。"""

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
        self._connections: list[_Connection] = []
        self._call_lock = asyncio.Lock()
        self._current: _Connection | None = None
        self._defer = 0
        self._pending: list[tuple[str, dict[str, Any], bool]] = []
        self._calls = 0
        self._frames_out = 0
        self._bytes_out = 0
        self._dropped = 0
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
            if conn.closed or topic not in conn.topics:
                continue
            self._queue_event(conn, topic, payload, coalesce)

    def _queue_event(
        self, conn: _Connection, topic: str, payload: dict[str, Any], coalesce: bool
    ) -> None:
        frame = event_frame(topic, payload)
        if coalesce:
            for index, queued in enumerate(conn.queue):
                if (
                    queued.get("type") == EVENT
                    and queued.get("topic") == topic
                    and queued is not conn.sending
                ):
                    conn.queue[index] = frame
                    conn.wakeup.set()
                    return
        if len(conn.queue) >= self._max_queue:
            self._dropped += 1
            self._log.trace("net.dropped", topic=topic)
            return
        conn.queue.append(frame)
        conn.wakeup.set()

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
        for name in names:
            conn.topics.setdefault(name, None)
        return {"topics": conn.topic_list()}

    def unsubscribe(self, topics: object = None) -> dict[str, list[str]]:
        """把 topics 从当前连接上摘掉；回剩下的列表。"""
        names = _parse_topics(topics)
        conn = self._current
        if conn is None:
            return {"topics": []}
        for name in names:
            conn.topics.pop(name, None)
        return {"topics": conn.topic_list()}

    # ---- 指标 ---------------------------------------------------------

    def stats(self) -> dict[str, Any]:
        """协议 §8 的字段。开发面板与日志读它，不靠感觉。"""
        return {
            "connections": len(self._connections),
            "calls": self._calls,
            "frames_out": self._frames_out,
            "bytes_out": self._bytes_out,
            "queue_depth": sum(len(conn.queue) for conn in self._connections),
            "dropped": self._dropped,
            "slow_calls": list(self._slow_calls),
        }

    # ---- 分发 ---------------------------------------------------------

    def handle(self, raw: object) -> Frame:
        """一帧进，一帧出。任何情况下都不往外抛异常。"""
        frame = self._call(raw, None)
        self._flush_pending()
        return frame

    def _call(self, raw: object, conn: _Connection | None) -> Frame:
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

    def _perform(
        self, raw: object, conn: _Connection | None
    ) -> tuple[Frame, str | None, str | None]:
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

    async def _dispatch(self, conn: _Connection, raw: object) -> None:
        async with self._call_lock:
            frame = self._call(raw, conn)
            if frame["id"] is not None and len(conn.queue) >= self._max_queue:
                frame = error_frame(frame["id"], OVERLOADED, "发送队列已满，退避后重试")
            self._enqueue_reply(conn, frame)
            self._flush_pending()

    def _enqueue_reply(self, conn: _Connection, frame: Frame) -> None:
        if len(conn.queue) >= self._max_queue:
            self._drop_oldest_event(conn)
        conn.queue.append(frame)
        conn.wakeup.set()

    def _drop_oldest_event(self, conn: _Connection) -> None:
        for index, queued in enumerate(conn.queue):
            if queued.get("type") == EVENT and queued is not conn.sending:
                del conn.queue[index]
                self._dropped += 1
                return

    # ---- 连接与发送 ---------------------------------------------------

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
        conn = _Connection(ws)
        self._connections.append(conn)
        self._log.debug("net.connected")
        send_task = asyncio.create_task(self._send_loop(conn))
        dispatches: set[asyncio.Task[None]] = set()
        try:
            async for message in ws:
                try:
                    raw = _decode(message)
                except FrameError as exc:
                    self._enqueue_reply(conn, error_frame(None, exc.code, str(exc)))
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

    async def _send_loop(self, conn: _Connection) -> None:
        while not conn.closed:
            await conn.wakeup.wait()
            conn.wakeup.clear()
            while conn.queue and not conn.closed:
                frame = conn.queue[0]
                conn.sending = frame
                text = _encode(frame)
                try:
                    await self._writer(conn.ws, text)
                except ConnectionClosed:
                    conn.closed = True
                    return
                finally:
                    conn.sending = None
                if conn.queue and conn.queue[0] is frame:
                    conn.queue.popleft()
                self._frames_out += 1
                self._bytes_out += len(text.encode("utf-8"))


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


def _encode(frame: Frame) -> str:
    return json.dumps(frame, ensure_ascii=False)


async def _send_text(ws: ServerConnection, text: str) -> None:
    await ws.send(text)


__all__ = ["DEFAULT_ORIGINS", "DEFAULT_QUEUE_MAX", "Net", "NetPlugin"]

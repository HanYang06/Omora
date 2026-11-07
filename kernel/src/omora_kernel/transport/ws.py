"""C1 传输：JSON-RPC 2.0 over WebSocket。

每个连接一条串行发送任务和一个有界发送队列：请求在读循环里先过 schema 校验，再
各自起任务并发处理，响应按 id 回填；事件推送与请求处理共用同一条队列，因此慢请求
不会挡住事件，慢客户端也不会挡住内核事件循环。
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import cast

from omora_kernel.capabilities import DeniedError
from omora_kernel.context import UnavailableError
from omora_kernel.contract.c1 import (
    CommandHandler,
    Event,
    EventSource,
    InvalidFrameError,
    QueryHandler,
    RequestFrame,
    SnapshotProvider,
    as_query_result,
    extract_request_id,
    validate_request_frame,
)
from websockets.asyncio.server import Server, ServerConnection, serve
from websockets.exceptions import ConnectionClosed

logger = logging.getLogger(__name__)

OUTBOUND_QUEUE_SIZE = 256
INTERNAL_ERROR_MESSAGE = "内部错误"
QUEUE_OVERFLOW_CODE = 1013


@dataclass(frozen=True, slots=True)
class C1Handlers:
    """传输层需要的四个窄接口；由装配方注入具体实现。"""

    commands: CommandHandler
    queries: QueryHandler
    snapshots: SnapshotProvider
    events: EventSource


def _error_frame(request_id: str | int | None, code: str, message: str) -> dict[str, object]:
    return {"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": message}}


def _name_and_args(params: Mapping[str, object]) -> tuple[str, Mapping[str, object]]:
    name = params.get("name")
    args = params.get("args", {})
    if not isinstance(name, str) or not isinstance(args, Mapping):
        raise InvalidFrameError("命令参数形状不一致")
    return name, cast("Mapping[str, object]", args)


class C1Server:
    """C1 WebSocket 服务；host 默认回环，port 传 0 由系统分配。"""

    def __init__(self, handlers: C1Handlers, *, host: str = "127.0.0.1", port: int = 0) -> None:
        self._handlers = handlers
        self._host = host
        self._port = port
        self._server: Server | None = None

    @property
    def handlers(self) -> C1Handlers:
        return self._handlers

    @property
    def port(self) -> int:
        """实际监听端口；未启动时抛 RuntimeError。"""
        if self._server is None:
            raise RuntimeError("C1 服务尚未启动")
        return self._port

    async def start(self) -> None:
        if self._server is not None:
            raise RuntimeError("C1 服务已启动")
        server = await serve(self._handle_connection, self._host, self._port)
        address = server.sockets[0].getsockname()
        if not isinstance(address, tuple) or not isinstance(address[1], int):
            server.close()
            await server.wait_closed()
            raise RuntimeError("C1 服务监听地址不合法")
        self._port = address[1]
        self._server = server

    async def stop(self) -> None:
        if self._server is None:
            return
        self._server.close()
        await self._server.wait_closed()
        self._server = None

    async def _handle_connection(self, websocket: ServerConnection) -> None:
        await _Connection(self, websocket).run()


class _Connection:
    """单条 WebSocket 连接：接收、并发派发、串行发送。"""

    def __init__(self, server: C1Server, websocket: ServerConnection) -> None:
        self._server = server
        self._websocket = websocket
        self._outbound: asyncio.Queue[str] = asyncio.Queue(maxsize=OUTBOUND_QUEUE_SIZE)
        self._tasks: set[asyncio.Task[None]] = set()
        self._unsubscribes: list[Callable[[], None]] = []
        self._closing = False

    async def run(self) -> None:
        sender = asyncio.create_task(self._send_outbound())
        try:
            async for raw in self._websocket:
                self._accept(raw)
        except ConnectionClosed:
            pass
        finally:
            for task in tuple(self._tasks):
                task.cancel()
            sender.cancel()
            await asyncio.gather(sender, *tuple(self._tasks), return_exceptions=True)
            for unsubscribe in self._unsubscribes:
                unsubscribe()
            self._unsubscribes.clear()

    async def _send_outbound(self) -> None:
        while True:
            payload = await self._outbound.get()
            await self._websocket.send(payload)

    def _accept(self, raw: str | bytes) -> None:
        try:
            payload: object = json.loads(raw)
        except ValueError:
            self._send_frame(_error_frame(None, "E_INVALID", "帧不是合法 JSON"))
            return
        try:
            frame = validate_request_frame(payload)
        except InvalidFrameError as error:
            request_id = extract_request_id(payload)
            self._send_frame(_error_frame(request_id, "E_INVALID", str(error)))
            return
        task = asyncio.create_task(self._handle(frame))
        self._tasks.add(task)
        task.add_done_callback(self._forget_task)

    async def _handle(self, frame: RequestFrame) -> None:
        try:
            result = await self._dispatch(frame)
        except DeniedError as error:
            self._send_frame(_error_frame(frame.id, "E_DENIED", str(error) or "能力未授予"))
        except UnavailableError as error:
            self._send_frame(_error_frame(frame.id, "E_UNAVAILABLE", str(error) or "依赖不可用"))
        except ValueError as error:
            self._send_frame(_error_frame(frame.id, "E_INVALID", str(error) or "请求失败"))
        except Exception:
            logger.exception("C1 请求 %s 失败", frame.method)
            self._send_frame(_error_frame(frame.id, "E_INTERNAL", INTERNAL_ERROR_MESSAGE))
        else:
            self._send_frame({"jsonrpc": "2.0", "id": frame.id, "result": result})

    async def _dispatch(self, frame: RequestFrame) -> object:
        match frame.method:
            case "state.snapshot":
                return await self._snapshot()
            case "cmd.invoke":
                return await self._command(frame.params)
            case "query.invoke":
                return await self._query(frame.params)
            case "event.subscribe":
                return self._subscribe(frame.params)
            case "ping":
                return {"revision": await self._server.handlers.snapshots.current_revision()}
            case _:
                raise InvalidFrameError(f"未知方法: {frame.method}")

    async def _snapshot(self) -> dict[str, object]:
        snapshot = await self._server.handlers.snapshots.snapshot()
        return {
            "revision": snapshot.revision,
            "state": dict(snapshot.state),
            "ui": dict(snapshot.ui),
        }

    async def _command(self, params: Mapping[str, object]) -> dict[str, object]:
        name, args = _name_and_args(params)
        result = await self._server.handlers.commands.invoke(name, args)
        revision = await self._server.handlers.snapshots.current_revision()
        return {"revision": revision, "result": result}

    async def _query(self, params: Mapping[str, object]) -> dict[str, object]:
        name, args = _name_and_args(params)
        page = await self._server.handlers.queries.invoke(name, args)
        return as_query_result(page)

    def _subscribe(self, params: Mapping[str, object]) -> dict[str, object]:
        value = params.get("since", 0)
        since = value if isinstance(value, int) and not isinstance(value, bool) else 0
        subscription = _Subscription(self._send_event, since)
        unsubscribe = self._server.handlers.events.subscribe(subscription.on_event)
        try:
            events = sorted(
                self._server.handlers.events.events_since(since),
                key=lambda event: event.revision,
            )
            for event in events:
                subscription.accept(event)
        except BaseException:
            unsubscribe()
            raise
        self._unsubscribes.append(unsubscribe)
        subscription.start_forwarding()
        return {"revision": subscription.revision}

    def _send_event(self, event: Event) -> None:
        params: dict[str, object] = {
            "type": event.type,
            "revision": event.revision,
            "data": dict(event.data),
        }
        if event.updates:
            params["updates"] = [
                {"owner": item.owner, "state": dict(item.state)} for item in event.updates
            ]
        self._send_frame({"jsonrpc": "2.0", "method": "event", "params": params})

    def _send_frame(self, frame: dict[str, object]) -> None:
        if self._closing:
            return
        try:
            payload = json.dumps(frame, ensure_ascii=False)
        except (TypeError, ValueError):
            logger.exception("C1 帧无法序列化")
            request_id = extract_request_id(frame)
            payload = json.dumps(
                _error_frame(request_id, "E_INTERNAL", INTERNAL_ERROR_MESSAGE), ensure_ascii=False
            )
        try:
            self._outbound.put_nowait(payload)
        except asyncio.QueueFull:
            self._close_with(QUEUE_OVERFLOW_CODE, "outbound queue overflow")

    def _close_with(self, code: int, reason: str) -> None:
        # 有界队列溢出时选择丢弃并断开，而不是合并：事件流是增量投影，合并会留下
        # 客户端看不见的 revision 空洞；断开后客户端带 since 重连，由事件日志补齐，
        # 比静默丢一帧安全，也让不读数据的慢客户端不再占用内核资源。
        if self._closing:
            return
        self._closing = True
        task = asyncio.create_task(self._websocket.close(code, reason))
        self._tasks.add(task)
        task.add_done_callback(self._forget_task)

    def _forget_task(self, task: asyncio.Task[None]) -> None:
        self._tasks.discard(task)
        if not task.cancelled():
            task.exception()


class _Subscription:
    """一次 event.subscribe 的补发与直播状态；按 revision 去重。"""

    def __init__(self, emit: Callable[[Event], None], since: int) -> None:
        self._emit = emit
        self._high_water = since
        self._buffer: list[Event] = []
        self._forwarding = False

    @property
    def revision(self) -> int:
        return self._high_water

    async def on_event(self, event: Event) -> None:
        self.accept(event)

    def accept(self, event: Event) -> None:
        if event.revision <= self._high_water:
            return
        if not self._forwarding:
            self._buffer.append(event)
            return
        self._deliver(event)

    def start_forwarding(self) -> None:
        self._forwarding = True
        pending = sorted(self._buffer, key=lambda event: event.revision)
        self._buffer.clear()
        for event in pending:
            self.accept(event)

    def _deliver(self, event: Event) -> None:
        self._high_water = event.revision
        self._emit(event)

"""net：WebSocket + 帧分发。

协议的形状是合同（见 docs/design/protocol.md），这里负责把它搬起来：
收帧、解析、找服务、调用、回帧。不做并发控制，不做推送。
"""

from __future__ import annotations

import json
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

from .media_http import MediaHttp

DEFAULT_ORIGINS = ("http://127.0.0.1:5173", "http://localhost:5173")

Frame = dict[str, Any]


class Net:
    """帧进来，帧出去。服务方法全是同步的，所以天然串行。"""

    def __init__(
        self,
        ctx: Context,
        host: str = "127.0.0.1",
        port: int = 8765,
        *,
        media_port: int = 0,
        media_origins: tuple[str, ...] = DEFAULT_ORIGINS,
    ) -> None:
        self.host = host
        self.port = port
        self._ctx = ctx
        self._server: Server | None = None
        self._media = MediaHttp(ctx, host=host, port=media_port, origins=media_origins)

    @property
    def media_url(self) -> str | None:
        """HTTP 媒体通道的地址；没起就是 None。视频插件按它决定能不能出捕捉条。"""
        return self._media.url

    def handle(self, raw: object) -> Frame:
        """一帧进，一帧出。任何情况下都不往外抛异常。"""
        try:
            call = parse_call(raw)
        except FrameError as exc:
            return error_frame(exc.frame_id, exc.code, str(exc))

        try:
            service = self._ctx.resolve(call.target)
        except LookupError as exc:
            return error_frame(call.id, UNKNOWN_TARGET, str(exc))

        method = getattr(service, call.method, None)
        if method is None or not callable(method):
            return error_frame(call.id, UNKNOWN_METHOD, f"{call.target} 没有方法 {call.method}")

        try:
            value: Any = method(**call.args)
        except Exception as exc:  # noqa: BLE001 — 服务抛什么都变成一帧错误
            return error_frame(call.id, CALL_FAILED, str(exc))
        return result_frame(call.id, value)

    async def serve(self) -> int:
        """起两件事：帧通道（WS）与 HTTP 媒体通道；返回 WS 端口。"""
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
        await self._media.stop()
        if self._server is not None:
            self._server.close()
            await self._server.wait_closed()
            self._server = None

    async def _connection(self, ws: ServerConnection) -> None:
        async for message in ws:
            try:
                raw = _decode(message)
            except FrameError as exc:
                await ws.send(_encode(error_frame(None, exc.code, str(exc))))
                continue
            await ws.send(_encode(self.handle(raw)))


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


def _decode(message: str | bytes) -> object:
    if isinstance(message, bytes):
        raise FrameError(BAD_FRAME, "只收文本帧")
    try:
        return json.loads(message)
    except ValueError as exc:
        raise FrameError(BAD_FRAME, f"不是合法 JSON: {exc}") from exc


def _encode(frame: Frame) -> str:
    return json.dumps(frame, ensure_ascii=False)


__all__ = ["DEFAULT_ORIGINS", "Net", "NetPlugin"]
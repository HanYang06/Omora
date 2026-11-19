"""HTTP 媒体通道：视频这类大字节不走 base64，走这条 HTTP。

net 是唯一持有 socket 的插件，所以路由在它这一半；存盘仍归 media 插件（按服务名取）。
只做两件事：

    POST /media        收一段字节，回 media id（视频上传）
    GET  /media/{id}   把字节原样还回去（播放）

HTTP/1.1 的解析、连接与关闭交给 aiohttp；这里只管路由、CORS、错误码与生命周期。
v0 的边界（CORS、上限、错误码、没有鉴权）写在 docs/design/protocol.md §7。
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

from aiohttp import web
from aiohttp.typedefs import Handler

from omora.sdk import Context

MEDIA_PREFIXES = ("audio/", "video/")
_JSON = "application/json"


class MediaHttp:
    """HTTP 媒体通道：aiohttp 的 AppRunner + TCPSite，端口 0 时取实际端口。"""

    def __init__(
        self,
        ctx: Context,
        *,
        host: str = "127.0.0.1",
        port: int | str = 0,
        origins: tuple[str, ...] = (),
    ) -> None:
        self.host = host
        self._want_port = int(port)
        self._ctx = ctx
        self._origins = origins
        self._runner: web.AppRunner | None = None
        self._port: int | None = None

    @property
    def url(self) -> str | None:
        """通道地址；没起就是 None（视频插件靠它决定能不能出捕捉条）。"""
        if self._port is None:
            return None
        return f"http://{self.host}:{self._port}/media"

    async def start(self) -> int:
        app = web.Application(middlewares=[self._middleware])
        # /media/ 后整段都算 id（含空串与 /，与旧实现一致）；合法性由 media 判。
        app.router.add_route("GET", "/media/{media_id:.*}", self._download)
        app.router.add_route("POST", "/media", self._upload)
        app.router.add_route("*", "/{tail:.*}", self._fallback)
        # 旧实现答完就关连接、不把没读的请求体挂着；aiohttp 默认会
        # 做 10s lingering close，stop() 会被它拖住。
        runner = web.AppRunner(app, access_log=None, lingering_time=0)
        await runner.setup()
        site = web.TCPSite(runner, self.host, self._want_port)
        try:
            await site.start()
        except OSError:
            await runner.cleanup()
            raise
        self._runner = runner
        self._port = site.port
        return self._port

    async def stop(self) -> None:
        runner, self._runner = self._runner, None
        if runner is not None:
            await runner.cleanup()
        self._port = None

    # ---- 路由 ---------------------------------------------------------

    @web.middleware
    async def _middleware(self, request: web.Request, handler: Handler) -> web.StreamResponse:
        try:
            response = await handler(request)
        except _HttpError as exc:
            response = _error(exc.status, str(exc))
        except web.HTTPException:
            raise
        except Exception as exc:
            # 旧实现把意外异常也回成 JSON 500；不让 aiohttp 换成纯文本。
            response = _error(500, str(exc))
        # v0 边界（protocol.md §7）：没有 keep-alive，一问一答就关连接。
        response.force_close()
        response.headers.update(self._cors(request.headers.get("Origin")))
        return response

    async def _upload(self, request: web.Request) -> web.StreamResponse:
        mime = request.headers.get("Content-Type", "").split(";")[0].strip().lower()
        if not mime.startswith(MEDIA_PREFIXES):
            raise _HttpError(415, f"只收音频 / 视频: {mime or '(空)'}")
        media = self._media()
        raw = request.headers.get("Content-Length")
        if raw is None or not raw.strip().isdigit():
            raise _HttpError(411, "需要 Content-Length")
        length = int(raw)
        if length > int(media.max_bytes):
            raise _HttpError(413, f"媒体太大: {length} 字节，上限 {media.max_bytes}")
        body = b""
        if length:
            try:
                body = await request.content.readexactly(length)
            except (asyncio.IncompleteReadError, ConnectionError) as exc:
                raise _HttpError(400, "请求体不完整") from exc
        try:
            media_id = media.upload(body, mime)
        except ValueError as exc:
            raise _HttpError(400, str(exc)) from exc
        return _json_response(201, {"media_id": str(media_id)})

    async def _download(self, request: web.Request) -> web.StreamResponse:
        media = self._media()
        try:
            piece: dict[str, Any] = media.read(request.match_info["media_id"])
        except LookupError as exc:
            raise _HttpError(404, str(exc)) from exc
        return web.Response(
            body=piece["data"],
            headers={
                "Content-Type": str(piece["mime"]),
                "Cache-Control": "no-store",
            },
        )

    async def _fallback(self, request: web.Request) -> web.StreamResponse:
        if request.method == "OPTIONS":
            return web.Response(status=204)
        raise _HttpError(404, "没有这个路由")

    # ---- 依赖与 CORS ---------------------------------------------------

    def _media(self) -> Any:
        try:
            return self._ctx.resolve("media")
        except LookupError as exc:
            raise _HttpError(503, "media 服务未提供") from exc

    def _cors(self, origin: str | None) -> dict[str, str]:
        if origin is None or origin not in self._origins:
            return {}
        return {
            "Access-Control-Allow-Origin": origin,
            "Vary": "Origin",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
        }


class _HttpError(Exception):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status


def _json(value: dict[str, Any]) -> bytes:
    return json.dumps(value, ensure_ascii=False).encode("utf-8")


def _json_response(status: int, value: dict[str, Any]) -> web.Response:
    """JSON 响应：Content-Type 与旧实现逐字一致，不带 charset。"""
    return web.Response(body=_json(value), status=status, headers={"Content-Type": _JSON})


def _error(status: int, message: str) -> web.Response:
    return _json_response(status, {"error": message})


__all__ = ["MediaHttp"]

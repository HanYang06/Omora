"""HTTP 媒体通道：视频这类大字节不走 base64，走这条 HTTP。

net 是唯一持有 socket 的插件，所以路由在它这一半；存盘仍归 media 插件（按服务名取）。
只做两件事：

    POST /media        收一段字节，回 media id（视频上传）
    GET  /media/{id}   把字节原样还回去（播放）

v0 的边界（CORS、上限、错误码、没有鉴权）写在 docs/design/protocol.md §7。
"""

from __future__ import annotations

import asyncio
import json
from typing import Any
from urllib.parse import unquote, urlsplit

from omora.sdk import Context

MAX_HEADER_BYTES = 16 * 1024
MEDIA_PREFIXES = ("audio/", "video/")
_REASONS = {
    200: "OK",
    201: "Created",
    204: "No Content",
    400: "Bad Request",
    404: "Not Found",
    411: "Length Required",
    413: "Payload Too Large",
    415: "Unsupported Media Type",
    500: "Internal Server Error",
    503: "Service Unavailable",
}


class MediaHttp:
    """最小 HTTP/1.1：一问一答，Connection: close，没有 keep-alive。"""

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
        self._server: asyncio.AbstractServer | None = None
        self._port: int | None = None

    @property
    def url(self) -> str | None:
        """通道地址；没起就是 None（视频插件靠它决定能不能出捕捉条）。"""
        if self._port is None:
            return None
        return f"http://{self.host}:{self._port}/media"

    async def start(self) -> int:
        self._server = await asyncio.start_server(self._connection, self.host, self._want_port)
        sockets = self._server.sockets or ()
        self._port = int(sockets[0].getsockname()[1]) if sockets else None
        return self._port or 0

    async def stop(self) -> None:
        if self._server is not None:
            self._server.close()
            await self._server.wait_closed()
            self._server = None
        self._port = None

    async def _connection(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            status, headers, body = await self._handle(reader)
        except Exception as exc:  # noqa: BLE001 — 一个坏请求不能把通道带崩
            status = 500
            headers = {"Content-Type": "application/json"}
            body = _json({"error": str(exc)})
        await _respond(writer, status, headers, body)

    async def _handle(self, reader: asyncio.StreamReader) -> tuple[int, dict[str, str], bytes]:
        try:
            line = await reader.readline()
        except asyncio.IncompleteReadError, ConnectionError:
            return 400, {}, _json({"error": "请求不完整"})
        parts = line.decode("latin-1").strip().split(" ")
        if len(parts) != 3:
            return 400, {}, _json({"error": "请求行不合法"})
        method, target, _version = parts
        try:
            headers = await _read_headers(reader)
        except ValueError as exc:
            return 400, {}, _json({"error": str(exc)})
        cors = self._cors(headers.get("origin"))
        try:
            status, extra, body = await self._route(method, target, headers, reader)
        except _HttpError as exc:
            status = exc.status
            extra = {"Content-Type": "application/json"}
            body = _json({"error": str(exc)})
        return status, {**cors, **extra}, body

    async def _route(
        self,
        method: str,
        target: str,
        headers: dict[str, str],
        reader: asyncio.StreamReader,
    ) -> tuple[int, dict[str, str], bytes]:
        path = urlsplit(target).path
        if method == "OPTIONS":
            return 204, {}, b""
        if method == "POST" and path == "/media":
            return await self._upload(headers, reader)
        if method == "GET" and path.startswith("/media/"):
            return self._download(unquote(path[len("/media/") :]))
        raise _HttpError(404, "没有这个路由")

    async def _upload(
        self, headers: dict[str, str], reader: asyncio.StreamReader
    ) -> tuple[int, dict[str, str], bytes]:
        mime = headers.get("content-type", "").split(";")[0].strip().lower()
        if not mime.startswith(MEDIA_PREFIXES):
            raise _HttpError(415, f"只收音频 / 视频: {mime or '(空)'}")
        media = self._media()
        raw = headers.get("content-length")
        if raw is None or not raw.strip().isdigit():
            raise _HttpError(411, "需要 Content-Length")
        length = int(raw)
        if length > int(media.max_bytes):
            raise _HttpError(413, f"媒体太大: {length} 字节，上限 {media.max_bytes}")
        try:
            body = await reader.readexactly(length)
        except (asyncio.IncompleteReadError, ConnectionError) as exc:
            raise _HttpError(400, "请求体不完整") from exc
        try:
            media_id = media.upload(body, mime)
        except ValueError as exc:
            raise _HttpError(400, str(exc)) from exc
        return 201, {"Content-Type": "application/json"}, _json({"media_id": str(media_id)})

    def _download(self, media_id: str) -> tuple[int, dict[str, str], bytes]:
        media = self._media()
        try:
            piece: dict[str, Any] = media.read(media_id)
        except LookupError as exc:
            raise _HttpError(404, str(exc)) from exc
        return 200, {"Content-Type": str(piece["mime"]), "Cache-Control": "no-store"}, piece["data"]

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


async def _read_headers(reader: asyncio.StreamReader) -> dict[str, str]:
    headers: dict[str, str] = {}
    total = 0
    while True:
        line = await reader.readline()
        if not line:
            raise ValueError("请求头不完整")
        total += len(line)
        if total > MAX_HEADER_BYTES:
            raise ValueError("请求头太大")
        if line in (b"\r\n", b"\n"):
            return headers
        name, _, value = line.decode("latin-1").partition(":")
        if not name.strip():
            raise ValueError("请求头不合法")
        headers[name.strip().lower()] = value.strip()


async def _respond(
    writer: asyncio.StreamWriter,
    status: int,
    headers: dict[str, str],
    body: bytes,
) -> None:
    try:
        merged = {
            "Content-Type": "application/octet-stream",
            "Content-Length": str(len(body)),
            "Connection": "close",
            **headers,
        }
        lines = [f"HTTP/1.1 {status} {_REASONS.get(status, 'OK')}"]
        lines.extend(f"{name}: {value}" for name, value in merged.items())
        writer.write(("\r\n".join(lines) + "\r\n\r\n").encode("latin-1") + body)
        await writer.drain()
    except ConnectionError, OSError:
        pass
    finally:
        writer.close()
        try:
            await writer.wait_closed()
        except ConnectionError, OSError:
            pass


def _json(value: dict[str, Any]) -> bytes:
    return json.dumps(value, ensure_ascii=False).encode("utf-8")


__all__ = ["MAX_HEADER_BYTES", "MediaHttp"]

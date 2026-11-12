import asyncio
import json
from pathlib import Path

from omora.core.context import Context
from omora.media import Media
from omora.media_http import MediaHttp
from omora.net import Net

ORIGIN = "http://127.0.0.1:5173"


def _ctx(tmp_path: Path, *, max_mb: int = 1) -> Context:
    ctx = Context()
    ctx.provide("media", Media(tmp_path / "media", max_mb=max_mb))
    return ctx


async def _serve(ctx: Context) -> tuple[Net, int]:
    net = Net(ctx, media_origins=(ORIGIN,))
    await net.serve()
    assert net.media_url is not None
    port = int(net.media_url.split(":")[2].split("/")[0])
    return net, port


async def _request(
    port: int,
    method: str,
    path: str,
    *,
    body: bytes = b"",
    headers: tuple[tuple[str, str], ...] = (),
    content_length: bool = True,
) -> tuple[int, dict[str, str], bytes]:
    reader, writer = await asyncio.open_connection("127.0.0.1", port)
    lines = [f"{method} {path} HTTP/1.1", "Host: 127.0.0.1"]
    lines.extend(f"{name}: {value}" for name, value in headers)
    if content_length:
        lines.append(f"Content-Length: {len(body)}")
    writer.write(("\r\n".join(lines) + "\r\n\r\n").encode("latin-1") + body)
    await writer.drain()
    status = int((await reader.readline()).decode("latin-1").split(" ")[1])
    got: dict[str, str] = {}
    while True:
        line = await reader.readline()
        if line in (b"\r\n", b"\n", b""):
            break
        name, _, value = line.decode("latin-1").partition(":")
        got[name.strip().lower()] = value.strip()
    length = int(got.get("content-length", "0"))
    payload = await reader.readexactly(length) if length else b""
    writer.close()
    await writer.wait_closed()
    return status, got, payload


def _upload(
    port: int, body: bytes = b"video-bytes", mime: str = "video/webm"
) -> tuple[int, dict[str, str], bytes]:
    return asyncio.run(
        _request(port, "POST", "/media", body=body, headers=(("Content-Type", mime),))
    )


def test_the_media_channel_has_no_url_before_it_starts(tmp_path: Path) -> None:
    assert Net(_ctx(tmp_path)).media_url is None


def test_uploading_a_video_returns_its_id(tmp_path: Path) -> None:
    async def scenario() -> tuple[dict[str, str], bytes]:
        ctx = _ctx(tmp_path)
        net, port = await _serve(ctx)
        try:
            status, headers, payload = await _request(
                port,
                "POST",
                "/media",
                body=b"video-bytes",
                headers=(("Content-Type", "video/webm"),),
            )
        finally:
            await net.stop()
        assert (status, headers["content-type"]) == (201, "application/json")
        media_id = str(json.loads(payload)["media_id"])
        return ctx.resolve("media").read(media_id), payload

    piece, _ = asyncio.run(scenario())

    assert piece == {"mime": "video/webm", "data": b"video-bytes"}


def test_playing_a_media_back_returns_the_bytes_and_the_mime(tmp_path: Path) -> None:
    async def scenario() -> tuple[int, dict[str, str], bytes]:
        ctx = _ctx(tmp_path)
        net, port = await _serve(ctx)
        try:
            media_id = ctx.resolve("media").save(b"video-bytes", "video/webm")
            return await _request(port, "GET", f"/media/{media_id}")
        finally:
            await net.stop()

    status, headers, payload = asyncio.run(scenario())

    assert (status, headers["content-type"], payload) == (200, "video/webm", b"video-bytes")


def test_an_unknown_media_id_is_404(tmp_path: Path) -> None:
    async def scenario() -> tuple[int, dict[str, str], bytes]:
        net, port = await _serve(_ctx(tmp_path))
        try:
            return await _request(port, "GET", "/media/nope")
        finally:
            await net.stop()

    status, _, payload = asyncio.run(scenario())

    assert status == 404
    assert "媒体不存在" in json.loads(payload)["error"]


def test_uploading_without_a_length_is_411(tmp_path: Path) -> None:
    async def scenario() -> int:
        net, port = await _serve(_ctx(tmp_path))
        try:
            status, _, _ = await _request(
                port,
                "POST",
                "/media",
                headers=(("Content-Type", "video/webm"),),
                content_length=False,
            )
            return status
        finally:
            await net.stop()

    assert asyncio.run(scenario()) == 411


def test_only_audio_and_video_can_be_uploaded(tmp_path: Path) -> None:
    async def scenario() -> int:
        net, port = await _serve(_ctx(tmp_path))
        try:
            status, _, _ = await _request(
                port,
                "POST",
                "/media",
                body=b"secret",
                headers=(("Content-Type", "text/plain"),),
            )
            return status
        finally:
            await net.stop()

    assert asyncio.run(scenario()) == 415


def test_a_upload_over_the_media_limit_is_413(tmp_path: Path) -> None:
    async def scenario() -> int:
        net, port = await _serve(_ctx(tmp_path, max_mb=1))
        try:
            status, _, _ = await _request(
                port,
                "POST",
                "/media",
                body=b"x" * (1024 * 1024 + 1),
                headers=(("Content-Type", "video/webm"),),
            )
            return status
        finally:
            await net.stop()

    assert asyncio.run(scenario()) == 413


def test_the_dev_origin_gets_cors_and_others_do_not(tmp_path: Path) -> None:
    async def scenario() -> tuple[dict[str, str], dict[str, str]]:
        net, port = await _serve(_ctx(tmp_path))
        try:
            _, allowed, _ = await _request(port, "OPTIONS", "/media", headers=(("Origin", ORIGIN),))
            _, other, _ = await _request(
                port, "OPTIONS", "/media", headers=(("Origin", "http://evil.example"),)
            )
            return allowed, other
        finally:
            await net.stop()

    allowed, other = asyncio.run(scenario())

    assert allowed["access-control-allow-origin"] == ORIGIN
    assert allowed["access-control-allow-methods"] == "GET, POST, OPTIONS"
    assert "access-control-allow-origin" not in other


def test_uploading_without_the_media_service_is_503(tmp_path: Path) -> None:
    async def scenario() -> int:
        net, port = await _serve(Context())
        try:
            status, _, _ = await _request(
                port,
                "POST",
                "/media",
                body=b"video-bytes",
                headers=(("Content-Type", "video/webm"),),
            )
            return status
        finally:
            await net.stop()

    assert asyncio.run(scenario()) == 503


def _handle_raw(tmp_path: Path, raw: bytes) -> tuple[int, dict[str, str], bytes]:
    async def scenario() -> tuple[int, dict[str, str], bytes]:
        server = MediaHttp(_ctx(tmp_path))
        reader = asyncio.StreamReader()
        reader.feed_data(raw)
        reader.feed_eof()
        return await server._handle(reader)

    return asyncio.run(scenario())


def test_a_malformed_request_line_is_400(tmp_path: Path) -> None:
    status, _, _ = _handle_raw(tmp_path, b"NOPE\r\n\r\n")

    assert status == 400


def test_a_truncated_body_is_400(tmp_path: Path) -> None:
    raw = b"POST /media HTTP/1.1\r\nContent-Type: video/webm\r\nContent-Length: 10\r\n\r\nab"

    status, _, _ = _handle_raw(tmp_path, raw)

    assert status == 400


def test_a_header_without_a_name_is_400(tmp_path: Path) -> None:
    status, _, _ = _handle_raw(tmp_path, b"GET /media/x HTTP/1.1\r\n: nope\r\n\r\n")

    assert status == 400


def test_an_unknown_route_is_404(tmp_path: Path) -> None:
    status, _, _ = _handle_raw(tmp_path, b"DELETE /nope HTTP/1.1\r\n\r\n")

    assert status == 404

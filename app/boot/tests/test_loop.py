import asyncio
import base64
import json
from pathlib import Path
from typing import Any

from websockets.asyncio.client import ClientConnection, connect

from boot import Config, build

MANIFEST = ("store", "manager", "media", "ui", "audio", "video", "ideas", "net")


def _nodes(node: dict[str, Any], node_type: str) -> list[dict[str, Any]]:
    found = [node] if node["type"] == node_type else []
    for child in node["children"]:
        found.extend(_nodes(child, node_type))
    return found


def _titles(snapshot: dict[str, Any]) -> list[str]:
    return [str(item["props"]["title"]) for item in _nodes(snapshot["content"], "item")]


def _find_capture(node: dict[str, Any], node_type: str) -> str | None:
    if node["type"] == node_type:
        return str(node["props"]["on_submit"])
    for child in node["children"]:
        nested = _find_capture(child, node_type)
        if nested is not None:
            return nested
    return None


def _find_tile(node: dict[str, Any], title: str) -> str | None:
    if node["type"] == "tile" and node["props"].get("title") == title:
        return str(node["props"]["on_click"])
    for child in node["children"]:
        nested = _find_tile(child, title)
        if nested is not None:
            return nested
    return None


def _find_item(node: dict[str, Any], title: str) -> str | None:
    if node["type"] == "item" and node["props"].get("title") == title:
        return str(node["props"]["on_click"])
    for child in node["children"]:
        nested = _find_item(child, title)
        if nested is not None:
            return nested
    return None


def _find_button(node: dict[str, Any], label: str) -> str | None:
    if node["type"] == "button" and node["props"].get("text") == label:
        return str(node["props"]["on_click"])
    for child in node["children"]:
        nested = _find_button(child, label)
        if nested is not None:
            return nested
    return None


async def _request(
    ws: ClientConnection, frame_id: str, target: str, method: str, args: dict[str, Any]
) -> Any:
    frame = {"id": frame_id, "type": "call", "target": target, "method": method, "args": args}
    await ws.send(json.dumps(frame))
    reply: dict[str, Any] = json.loads(await ws.recv())
    assert reply["type"] == "result", reply
    return reply["value"]


def _media_port(net: Any) -> int:
    url = str(net.media_url)
    return int(url.split(":")[2].split("/")[0])


async def _post(port: int, body: bytes, mime: str) -> tuple[int, bytes]:
    """直接打 HTTP 媒体通道：视频不走 WS，也不走 base64。"""
    reader, writer = await asyncio.open_connection("127.0.0.1", port)
    head = (
        "POST /media HTTP/1.1\r\n"
        "Host: 127.0.0.1\r\n"
        f"Content-Type: {mime}\r\n"
        f"Content-Length: {len(body)}\r\n\r\n"
    ).encode("latin-1")
    writer.write(head + body)
    await writer.drain()
    status = int((await reader.readline()).decode("latin-1").split(" ")[1])
    length = 0
    while True:
        line = await reader.readline()
        if line in (b"\r\n", b"\n", b""):
            break
        key, _, value = line.decode("latin-1").partition(":")
        if key.strip().lower() == "content-length":
            length = int(value.strip())
    payload = await reader.readexactly(length) if length else b""
    writer.close()
    await writer.wait_closed()
    return status, payload


async def _get(url: str) -> bytes:
    host, _, rest = url.partition("://")[2].partition("/")
    name, _, port_text = host.partition(":")
    reader, writer = await asyncio.open_connection(name, int(port_text))
    writer.write(f"GET /{rest} HTTP/1.1\r\nHost: {host}\r\n\r\n".encode("latin-1"))
    await writer.drain()
    status = (await reader.readline()).decode("latin-1")
    assert " 200 " in status, status
    length = 0
    while True:
        line = await reader.readline()
        if line in (b"\r\n", b"\n", b""):
            break
        key, _, value = line.decode("latin-1").partition(":")
        if key.strip().lower() == "content-length":
            length = int(value.strip())
    body = await reader.readexactly(length) if length else b""
    writer.close()
    await writer.wait_closed()
    return body


def test_clicking_archive_over_the_socket_updates_the_page(tmp_path: Path) -> None:
    async def scenario() -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
        config = Config(
            {
                "net": {"port": 0},
                "store": {"path": str(tmp_path / "omora.db")},
                "media": {"root": str(tmp_path / "media")},
            }
        )
        kernel = build(config, MANIFEST)
        net = kernel.resolve("net")
        port = await net.serve()
        try:
            async with connect(f"ws://127.0.0.1:{port}") as ws:
                empty = await _request(ws, "1", "ui", "render", {})
                tile = _find_tile(empty["content"], "文字")
                assert tile is not None
                capture_page = await _request(
                    ws, "2", "ui", "event", {"handler": tile, "payload": {}}
                )
                capture = _find_capture(capture_page["content"], "input")
                assert capture is not None
                before = await _request(
                    ws,
                    "3",
                    "ui",
                    "event",
                    {"handler": capture, "payload": {"value": "买牛奶"}},
                )
                opened = _find_item(before["content"], "买牛奶")
                assert opened is not None
                detail = await _request(
                    ws, "4", "ui", "event", {"handler": opened, "payload": {}}
                )
                handler = _find_button(detail["content"], "归档")
                assert handler is not None
                after = await _request(
                    ws, "5", "ui", "event", {"handler": handler, "payload": {}}
                )
                return empty, before, after
        finally:
            await net.stop()

    empty, before, after = asyncio.run(scenario())

    assert empty["meta"] == "0 条"
    assert before["page"] == "ideas"
    assert before["pages"][0]["label"] == "灵感"
    assert before["pages"][0]["count"] == 1
    assert _titles(before) == ["买牛奶"]
    assert _titles(after) == []
    assert after["pages"][0]["count"] == 0
    assert _nodes(after["content"], "empty")[0]["props"]["title"] == "还没有灵感。"


def test_audio_capture_and_media_load_over_the_socket(tmp_path: Path) -> None:
    async def scenario() -> dict[str, Any]:
        config = Config(
            {
                "net": {"port": 0},
                "store": {"path": str(tmp_path / "omora.db")},
                "media": {"root": str(tmp_path / "media")},
            }
        )
        kernel = build(config, MANIFEST)
        net = kernel.resolve("net")
        port = await net.serve()
        try:
            # 客户端上报能力之后，manager 才把 audio / video 装上。
            kernel.resolve("manager").report_capabilities(["microphone", "camera"])
            status, payload = await _post(_media_port(net), b"hello", "audio/webm")
            assert status == 201, payload
            audio_id = str(json.loads(payload)["media_id"])
            async with connect(f"ws://127.0.0.1:{port}") as ws:
                before = await _request(ws, "1", "ui", "render", {})
                tile = _find_tile(before["content"], "录音")
                assert tile is not None
                capture_page = await _request(
                    ws, "2", "ui", "event", {"handler": tile, "payload": {}}
                )
                handler = _find_capture(capture_page["content"], "audio_capture")
                assert handler is not None
                after = await _request(
                    ws,
                    "3",
                    "ui",
                    "event",
                    {
                        "handler": handler,
                        "payload": {"media": audio_id, "mime": "audio/webm", "seconds": 2.0},
                    },
                )
                opened = _find_item(after["content"], "语音 0:02")
                assert opened is not None
                detail = await _request(
                    ws, "4", "ui", "event", {"handler": opened, "payload": {}}
                )
                media_id = str(_nodes(detail["content"], "audio")[0]["props"]["media"])
                loaded = await _request(ws, "5", "media", "load", {"media_id": media_id})
                assert isinstance(loaded, dict)
                return loaded
        finally:
            await net.stop()

    loaded = asyncio.run(scenario())

    assert loaded["mime"] == "audio/webm"
    assert base64.b64decode(str(loaded["data"])) == b"hello"


def test_video_capture_uploads_over_http_and_plays_back(tmp_path: Path) -> None:
    async def scenario() -> tuple[dict[str, Any], bytes]:
        config = Config(
            {
                "net": {"port": 0},
                "store": {"path": str(tmp_path / "omora.db")},
                "media": {"root": str(tmp_path / "media")},
            }
        )
        kernel = build(config, MANIFEST)
        net = kernel.resolve("net")
        port = await net.serve()
        try:
            kernel.resolve("manager").report_capabilities(["microphone", "camera"])
            status, payload = await _post(_media_port(net), b"video-bytes", "video/webm")
            assert status == 201, payload
            media_id = str(json.loads(payload)["media_id"])
            async with connect(f"ws://127.0.0.1:{port}") as ws:
                before = await _request(ws, "1", "ui", "render", {})
                tile = _find_tile(before["content"], "视频")
                assert tile is not None
                capture_page = await _request(
                    ws, "2", "ui", "event", {"handler": tile, "payload": {}}
                )
                handler = _find_capture(capture_page["content"], "video_capture")
                assert handler is not None
                after = await _request(
                    ws,
                    "3",
                    "ui",
                    "event",
                    {
                        "handler": handler,
                        "payload": {"media": media_id, "mime": "video/webm", "seconds": 4},
                    },
                )
                opened = _find_item(after["content"], "视频 0:04")
                assert opened is not None
                detail = await _request(
                    ws, "4", "ui", "event", {"handler": opened, "payload": {}}
                )
                src = str(_nodes(detail["content"], "video")[0]["props"]["src"])
                fetched = await _get(src)
                return after, fetched
        finally:
            await net.stop()

    after, fetched = asyncio.run(scenario())

    assert _titles(after) == ["视频 0:04"]
    assert fetched == b"video-bytes"


def test_plugin_inventory_and_toggle_over_the_socket(tmp_path: Path) -> None:
    async def scenario() -> tuple[Any, dict[str, Any], dict[str, Any], dict[str, Any]]:
        config = Config(
            {
                "net": {"port": 0},
                "store": {"path": str(tmp_path / "omora.db")},
                "media": {"root": str(tmp_path / "media")},
            }
        )
        kernel = build(config, MANIFEST)
        net = kernel.resolve("net")
        port = await net.serve()
        try:
            async with connect(f"ws://127.0.0.1:{port}") as ws:
                inventory = await _request(ws, "1", "manager", "inventory", {})
                reported = await _request(
                    ws,
                    "2",
                    "manager",
                    "report_capabilities",
                    {"capabilities": ["microphone"]},
                )
                toggled = await _request(
                    ws,
                    "3",
                    "manager",
                    "set_enabled",
                    {"name": "ideas", "enabled": False},
                )
                return kernel, inventory, reported, toggled
        finally:
            await net.stop()

    kernel, inventory, reported, toggled = asyncio.run(scenario())

    rows = {row["name"]: row for row in inventory["plugins"]}
    assert list(rows) == list(MANIFEST)
    assert rows["ideas"]["phase"] == "active"
    assert rows["store"]["bootstrap"] is True
    assert reported["capabilities"] == ["microphone"]
    after = {row["name"]: row for row in toggled["plugins"]}
    assert after["ideas"]["phase"] == "disabled"
    assert after["ideas"]["reason"]["code"] == "disabled-by-setting"
    assert kernel.running("ideas") is False

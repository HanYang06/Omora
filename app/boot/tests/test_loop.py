import asyncio
import base64
import json
from datetime import datetime
from pathlib import Path
from typing import Any

from websockets.asyncio.client import ClientConnection, connect

import omora._capture as ideas_capture
from boot import Config, build

MANIFEST = ("store", "manager", "media", "ui", "audio", "video", "ideas", "net")
SAVED_AT = datetime(2026, 11, 11, 3, 41)


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
    """发一帧 call，收它的一帧 result。"""

    frame = {"id": frame_id, "type": "call", "target": target, "method": method, "args": args}
    await ws.send(json.dumps(frame))
    reply: dict[str, Any] = json.loads(await ws.recv())
    assert reply["type"] == "result", reply
    assert reply["id"] == frame_id, reply
    return reply["value"]


async def _subscribe(ws: ClientConnection, frame_id: str) -> None:
    """连接后先订阅：没订阅的连接收不到 event（net 侧过滤，不靠客户端忽略）。"""

    result = await _request(ws, frame_id, "net", "subscribe", {"topics": ["ui.snapshot"]})
    assert result == {"topics": ["ui.snapshot"]}, result


async def _event(
    ws: ClientConnection,
    frame_id: str,
    handler: str,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """发一次 ui.event：先收到 result（确认，值为 {}），再收到它触发的 ui.snapshot。

    顺序是协议 §4 的保证：一次 call 处理期间 emit 的 event 排在 result 之后，
    客户端不会先拿到一份自己还没有版本的视图。
    """

    value = await _request(
        ws, frame_id, "ui", "event", {"handler": handler, "payload": payload or {}}
    )
    assert value == {}, f"ui.event 的 result 只剩确认，实际 {value!r}"
    frame: dict[str, Any] = json.loads(await ws.recv())
    assert frame["type"] == "event", f"result 之后应该先到 ui.snapshot，实际是 {frame!r}"
    assert frame["topic"] == "ui.snapshot", frame
    pushed = frame["payload"]
    assert isinstance(pushed, dict), pushed
    return pushed


def _assert_patch(payload: dict[str, Any], *, base: int) -> None:
    """同一页的变化是一条补丁：page / version / base / ops 都要对得上上一份快照。"""

    assert "content" not in payload, f"这一条应该是补丁，不是全量: {payload!r}"
    assert payload["page"], payload
    assert payload["base"] == base, payload
    assert payload["version"] == base + 1, payload
    assert payload["ops"], "补丁不许是空的"


def _assert_full(payload: dict[str, Any], *, page: str) -> None:
    """补不了就推全量：带整棵 content 与版本，没有 ops / base。"""

    assert "ops" not in payload, f"全量不该带 ops: {payload!r}"
    assert payload["page"] == page, payload
    assert payload["content"]["type"], payload
    assert isinstance(payload["version"], int), payload


def _media_port(net: Any) -> int:
    url = str(net.media_url)
    return int(url.split(":")[2].split("/", maxsplit=1)[0])


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
                await _subscribe(ws, "1")
                empty = await _request(ws, "2", "ui", "render", {})
                tile = _find_tile(empty["content"], "文字")
                assert tile is not None

                pushed = await _event(ws, "3", tile)
                _assert_patch(pushed, base=empty["version"])

                capture_page = await _request(ws, "4", "ui", "render", {})
                capture = _find_capture(capture_page["content"], "input")
                assert capture is not None

                pushed = await _event(ws, "5", capture, {"value": "买牛奶"})
                _assert_patch(pushed, base=capture_page["version"])

                before = await _request(ws, "6", "ui", "render", {})
                opened = _find_item(before["content"], "买牛奶")
                assert opened is not None

                pushed = await _event(ws, "7", opened)
                _assert_patch(pushed, base=before["version"])

                detail = await _request(ws, "8", "ui", "render", {})
                handler = _find_button(detail["content"], "归档")
                assert handler is not None

                pushed = await _event(ws, "9", handler)
                _assert_patch(pushed, base=detail["version"])

                after = await _request(ws, "10", "ui", "render", {})
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


def test_a_snapshot_for_another_page_arrives_as_a_full_snapshot(tmp_path: Path) -> None:
    """客户端在看别的页时，服务端补不了那一页的差额，只能推全量（协议 §6.1）。"""

    async def scenario() -> tuple[dict[str, Any], dict[str, Any]]:
        config = Config(
            {
                "net": {"port": 0},
                "store": {"path": str(tmp_path / "omora.db")},
                "media": {"root": str(tmp_path / "media")},
            }
        )
        kernel = build(config, MANIFEST)
        # 上报能力这一步会让 manager 把设置页挂到 ui 上（boot 里 ui 是 manager 后装的）。
        kernel.resolve("manager").report_capabilities([])
        net = kernel.resolve("net")
        port = await net.serve()
        try:
            async with connect(f"ws://127.0.0.1:{port}") as ws:
                await _subscribe(ws, "1")
                ideas = await _request(ws, "2", "ui", "render", {})
                tile = _find_tile(ideas["content"], "文字")
                assert tile is not None

                plugins = await _request(ws, "3", "ui", "render", {"page": "plugins"})
                assert plugins["page"] == "plugins"

                pushed = await _event(ws, "4", tile)
                return ideas, pushed
        finally:
            await net.stop()

    ideas, pushed = asyncio.run(scenario())

    _assert_full(pushed, page=ideas["page"])
    assert pushed["version"] == ideas["version"] + 1
    assert pushed["content"]["type"] == ideas["content"]["type"]


def test_audio_capture_and_media_load_over_the_socket(tmp_path: Path, monkeypatch: Any) -> None:
    # 默认名读的是保存时刻：把捕捉的钟钉住，断言才不会随分钟漂。
    monkeypatch.setattr(ideas_capture, "now", lambda: SAVED_AT)

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
                await _subscribe(ws, "1")
                before = await _request(ws, "2", "ui", "render", {})
                tile = _find_tile(before["content"], "录音")
                assert tile is not None

                pushed = await _event(ws, "3", tile)
                _assert_patch(pushed, base=before["version"])

                capture_page = await _request(ws, "4", "ui", "render", {})
                handler = _find_capture(capture_page["content"], "audio_capture")
                assert handler is not None

                pushed = await _event(
                    ws,
                    "5",
                    handler,
                    {"media": audio_id, "mime": "audio/webm", "seconds": 2.0},
                )
                _assert_patch(pushed, base=capture_page["version"])

                after = await _request(ws, "6", "ui", "render", {})
                opened = _find_item(after["content"], "语音 11-11 03:41")
                assert opened is not None

                pushed = await _event(ws, "7", opened)
                _assert_patch(pushed, base=after["version"])

                detail = await _request(ws, "8", "ui", "render", {})
                media_id = str(_nodes(detail["content"], "audio")[0]["props"]["media"])
                loaded = await _request(ws, "9", "media", "load", {"media_id": media_id})
                assert isinstance(loaded, dict)
                return loaded
        finally:
            await net.stop()

    loaded = asyncio.run(scenario())

    assert loaded["mime"] == "audio/webm"
    assert base64.b64decode(str(loaded["data"])) == b"hello"


def test_video_capture_uploads_over_http_and_plays_back(tmp_path: Path, monkeypatch: Any) -> None:
    monkeypatch.setattr(ideas_capture, "now", lambda: SAVED_AT)

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
                await _subscribe(ws, "1")
                before = await _request(ws, "2", "ui", "render", {})
                tile = _find_tile(before["content"], "视频")
                assert tile is not None

                pushed = await _event(ws, "3", tile)
                _assert_patch(pushed, base=before["version"])

                capture_page = await _request(ws, "4", "ui", "render", {})
                handler = _find_capture(capture_page["content"], "video_capture")
                assert handler is not None

                pushed = await _event(
                    ws,
                    "5",
                    handler,
                    {"media": media_id, "mime": "video/webm", "seconds": 4},
                )
                _assert_patch(pushed, base=capture_page["version"])

                after = await _request(ws, "6", "ui", "render", {})
                opened = _find_item(after["content"], "视频 11-11 03:41")
                assert opened is not None

                pushed = await _event(ws, "7", opened)
                _assert_patch(pushed, base=after["version"])

                detail = await _request(ws, "8", "ui", "render", {})
                src = str(_nodes(detail["content"], "video")[0]["props"]["src"])
                fetched = await _get(src)
                return after, fetched
        finally:
            await net.stop()

    after, fetched = asyncio.run(scenario())

    assert _titles(after) == ["视频 11-11 03:41"]
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

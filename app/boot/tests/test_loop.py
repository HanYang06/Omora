import asyncio
import base64
import json
from pathlib import Path
from typing import Any

from websockets.asyncio.client import ClientConnection, connect

from boot import Config, build

MANIFEST = ("store", "media", "ui", "ideas", "net")


def _nodes(node: dict[str, Any], node_type: str) -> list[dict[str, Any]]:
    found = [node] if node["type"] == node_type else []
    for child in node["children"]:
        found.extend(_nodes(child, node_type))
    return found


def _titles(snapshot: dict[str, Any]) -> list[str]:
    return [str(item["props"]["title"]) for item in _nodes(snapshot["content"], "item")]


def _find_button(node: dict[str, Any], label: str) -> str | None:
    if node["type"] == "button" and node["props"].get("text") == label:
        return str(node["props"]["on_click"])
    for child in node["children"]:
        nested = _find_button(child, label)
        if nested is not None:
            return nested
    return None


def _find_recorder(node: dict[str, Any]) -> str | None:
    if node["type"] == "recorder":
        return str(node["props"]["on_submit"])
    for child in node["children"]:
        nested = _find_recorder(child)
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


def test_clicking_archive_over_the_socket_updates_the_page(tmp_path: Path) -> None:
    async def scenario() -> tuple[dict[str, Any], dict[str, Any]]:
        config = Config(
            {
                "net": {"port": 0},
                "store": {"path": str(tmp_path / "omora.db")},
                "media": {"root": str(tmp_path / "media")},
            }
        )
        kernel = build(config, MANIFEST)
        kernel.resolve("store").add("买牛奶")
        net = kernel.resolve("net")
        port = await net.serve()
        try:
            async with connect(f"ws://127.0.0.1:{port}") as ws:
                before = await _request(ws, "1", "ui", "render", {})
                handler = _find_button(before["content"], "归档")
                assert handler is not None
                after = await _request(
                    ws, "2", "ui", "event", {"handler": handler, "payload": {}}
                )
                return before, after
        finally:
            await net.stop()

    before, after = asyncio.run(scenario())

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
            async with connect(f"ws://127.0.0.1:{port}") as ws:
                before = await _request(ws, "1", "ui", "render", {})
                handler = _find_recorder(before["content"])
                assert handler is not None
                audio = base64.b64encode(b"hello").decode("ascii")
                after = await _request(
                    ws,
                    "2",
                    "ui",
                    "event",
                    {
                        "handler": handler,
                        "payload": {"audio": audio, "mime": "audio/webm", "seconds": 2.0},
                    },
                )
                media_id = str(_nodes(after["content"], "audio")[0]["props"]["media"])
                loaded = await _request(ws, "3", "media", "load", {"media_id": media_id})
                assert isinstance(loaded, dict)
                return loaded
        finally:
            await net.stop()

    loaded = asyncio.run(scenario())

    assert loaded["mime"] == "audio/webm"
    assert base64.b64decode(str(loaded["data"])) == b"hello"

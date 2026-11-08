import asyncio
import json
from typing import Any

from websockets.asyncio.client import ClientConnection, connect

from boot import Config, build
from packages.inbox import InboxPlugin
from packages.net import Net, NetPlugin
from packages.store import StorePlugin
from packages.ui import UiPlugin

MANIFEST = (
    ("store", StorePlugin),
    ("ui", UiPlugin),
    ("inbox", InboxPlugin),
    ("net", NetPlugin),
)


def _texts(nodes: list[dict[str, Any]]) -> list[str]:
    found: list[str] = []
    for node in nodes:
        if node["type"] == "text":
            found.append(node["props"]["text"])
        found.extend(_texts(node["children"]))
    return found


def _find_button(nodes: list[dict[str, Any]], label: str) -> str | None:
    for node in nodes:
        if node["type"] == "button" and node["props"].get("text") == label:
            handler: str = node["props"]["on_click"]
            return handler
        nested = _find_button(node["children"], label)
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


def test_clicking_archive_over_the_socket_updates_the_tree() -> None:
    async def scenario() -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        kernel = build(Config({"net": {"port": 0}}), MANIFEST)
        kernel.resolve("store").add("买牛奶")
        net: Net = kernel.resolve("net")
        port = await net.serve()
        try:
            async with connect(f"ws://127.0.0.1:{port}") as ws:
                before = await _request(ws, "1", "ui", "render", {"view": "main"})
                handler = _find_button(before, "归档")
                assert handler is not None
                after = await _request(
                    ws, "2", "ui", "event", {"handler": handler, "payload": {}}
                )
                return before, after
        finally:
            await net.stop()

    before, after = asyncio.run(scenario())

    assert _texts(before) == ["收件箱", "买牛奶"]
    assert _texts(after) == ["收件箱"]

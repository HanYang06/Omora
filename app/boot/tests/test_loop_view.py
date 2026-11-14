"""S6 主会话 Slot 视图：真实插件经 WebSocket 的一次往返（Python 产出端 e2e）。

钉住两件事：
- `ui.render` 交 `view`（wire.md §8）：局部树 + 页面侧表 + active + data + version；
- 事件的结果直接就是新 view，不再另推 patch / snapshot 帧。
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any, cast

from websockets.asyncio.client import connect

from boot import Config, build

MANIFEST = ("store", "manager", "media", "ui", "audio", "video", "ideas", "net")

NAV_MOUNT_AT = "dendro.window.nav"
PAGE_MOUNT_AT = "dendro.window.page"


async def _request(ws: Any, frame_id: str, target: str, method: str, args: dict[str, Any]) -> Any:
    """发一帧 call，收它的一帧 result。"""
    frame = {"id": frame_id, "type": "call", "target": target, "method": method, "args": args}
    await ws.send(json.dumps(frame))
    reply: dict[str, Any] = json.loads(await ws.recv())
    assert reply["type"] == "result", reply
    assert reply["id"] == frame_id, reply
    return reply["value"]


async def _event(ws: Any, frame_id: str, handler: str, payload: dict[str, Any]) -> dict[str, Any]:
    value = await _request(ws, frame_id, "ui", "event", {"handler": handler, "payload": payload})
    assert value["kind"] == "view", value
    return cast(dict[str, Any], value)


def _slots(node: dict[str, Any], kind: str) -> list[dict[str, Any]]:
    found = [node] if node.get("kind") == kind else []
    for child in node.get("children", []):
        found.extend(_slots(child, kind))
    return found


def _tree(view: dict[str, Any], mount_at: str) -> dict[str, Any]:
    for tree in view["localTrees"]["trees"]:
        if tree["mountAt"] == mount_at:
            return cast(dict[str, Any], tree)
    raise AssertionError(f"view 里没有挂在 {mount_at} 的局部树: {view!r}")


def _page_link(view: dict[str, Any], label: str) -> dict[str, Any]:
    for link in _slots(_tree(view, NAV_MOUNT_AT)["root"], "dendro:page-link"):
        if link["props"].get("label") == label:
            return link
    raise AssertionError(f"导航里没有 {label!r} 的入口")


def test_slot_view_roundtrip_over_the_socket(tmp_path: Path) -> None:
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
                first = await _request(ws, "1", "ui", "render", {})
                handler = _page_link(first, "插件")["events"]["click"]
                switched = await _event(ws, "2", handler, {})
                again = await _request(ws, "3", "ui", "render", {})
                return first, switched, again
        finally:
            await net.stop()

    first, switched, again = asyncio.run(scenario())

    # 第一份视图：信封 / 页面侧表 / 两棵局部树 / 版本从 1 开始。
    assert first["kind"] == "view"
    assert first["schema"] == "dendro.ui/1"
    assert first["version"] == 1
    assert first["active"] == "page.ideas"
    assert first["data"] == {}
    assert [page["id"] for page in first["pages"]] == ["page.ideas", "page.plugins"]
    assert _tree(first, PAGE_MOUNT_AT)["root"]["id"] == "page.ideas"

    # 点导航：active 换页、页面树换根、版本前进。
    assert switched["kind"] == "view"
    assert switched["active"] == "page.plugins"
    assert switched["version"] == 2
    assert _tree(switched, PAGE_MOUNT_AT)["root"]["id"] == "page.plugins"
    assert _page_link(switched, "灵感")["events"]["click"]

    # 再拉一次仍在当前页，版本继续单调。
    assert again["kind"] == "view"
    assert again["active"] == "page.plugins"
    assert again["version"] == 3


def test_an_event_returns_the_view_without_a_second_frame(tmp_path: Path) -> None:
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
                await _request(ws, "1", "net", "subscribe", {"topics": ["ui.snapshot"]})
                first = await _request(ws, "2", "ui", "render", {})
                handler = _page_link(first, "插件")["events"]["click"]
                view = await _event(ws, "3", handler, {})
                # 事件的变化搭 result 的车：后面不应再排一帧 ui.snapshot。
                try:
                    extra = await asyncio.wait_for(ws.recv(), timeout=0.2)
                except TimeoutError:
                    extra = None
                assert extra is None, f"事件之后不该再推帧: {extra!r}"
                return view
        finally:
            await net.stop()

    view = asyncio.run(scenario())

    assert view["kind"] == "view"
    assert view["version"] == 2
    assert view["active"] == "page.plugins"


async def _call(
    ws: Any, frame_id: str, target: str, method: str, args: dict[str, Any]
) -> dict[str, Any]:
    """发一帧 call，原样收一帧回复（result 或 error）。"""
    frame = {"id": frame_id, "type": "call", "target": target, "method": method, "args": args}
    await ws.send(json.dumps(frame))
    reply: dict[str, Any] = json.loads(await ws.recv())
    assert reply["id"] == frame_id, reply
    return reply


def test_engine_argument_is_rejected_over_the_socket(tmp_path: Path) -> None:
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
                return await _call(ws, "1", "ui", "render", {"engine": "slot"})
        finally:
            await net.stop()

    reply = asyncio.run(scenario())

    assert reply["type"] == "error"
    assert reply["code"] == "call_failed"
    assert "engine" in reply["message"]


def test_rendering_an_unknown_page_returns_an_error_frame(tmp_path: Path) -> None:
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
                return await _call(ws, "1", "ui", "render", {"page": "missing"})
        finally:
            await net.stop()

    reply = asyncio.run(scenario())

    assert reply["type"] == "error"
    assert reply["code"] == "call_failed"
    assert "未知页面" in reply["message"]


def test_an_unknown_handler_returns_an_error_frame(tmp_path: Path) -> None:
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
                await _request(ws, "1", "ui", "render", {})
                return await _call(ws, "2", "ui", "event", {"handler": "nope:1:0", "payload": {}})
        finally:
            await net.stop()

    reply = asyncio.run(scenario())

    assert reply["type"] == "error"
    assert reply["code"] == "call_failed"
    assert "未知 handler" in reply["message"]


def test_a_stale_handler_from_the_previous_view_fires_once(tmp_path: Path) -> None:
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
                first = await _request(ws, "1", "ui", "render", {})
                stale = _page_link(first, "插件")["events"]["click"]
                await _request(ws, "2", "ui", "render", {})
                reply = await _request(ws, "3", "ui", "event", {"handler": stale, "payload": {}})
                return cast(dict[str, Any], reply)
        finally:
            await net.stop()

    view = asyncio.run(scenario())

    assert view["kind"] == "view"
    assert view["version"] == 3
    assert view["active"] == "page.plugins"


def test_a_page_push_arrives_as_a_view_frame(tmp_path: Path) -> None:
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
                await _request(ws, "1", "net", "subscribe", {"topics": ["ui.snapshot"]})
                await _request(ws, "2", "ui", "render", {"page": "plugins"})
                await _request(
                    ws,
                    "3",
                    "manager",
                    "report_devices",
                    {"devices": ["audioinput"]},
                )
                frame: dict[str, Any] = json.loads(await ws.recv())
                return frame
        finally:
            await net.stop()

    frame = asyncio.run(scenario())

    assert frame["type"] == "event"
    assert frame["topic"] == "ui.snapshot"
    payload = frame["payload"]
    assert payload["kind"] == "view"
    assert payload["version"] == 2
    assert "audioinput" in json.dumps(payload, ensure_ascii=False)

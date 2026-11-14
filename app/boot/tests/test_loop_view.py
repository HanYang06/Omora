"""S6 主会话 Slot 视图：真实插件经 WebSocket 的一次往返（Python 产出端 e2e）。

钉住三件事：
- `ui.render {engine:"slot"}` 交 `view`（wire.md §8）：局部树 + 页面侧表 + active + data + version；
- 导航 page-link 的 handler 经 `ui.event {engine:"slot"}` 回传后，
  active / 页面树 / version 一起前进；
- legacy 出口没被改坏：同一个 Ui 实例再调不带 engine 的 render，仍拿到旧快照形状。
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

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


def _slots(node: dict[str, Any], kind: str) -> list[dict[str, Any]]:
    found = [node] if node.get("kind") == kind else []
    for child in node.get("children", []):
        found.extend(_slots(child, kind))
    return found


def _tree(view: dict[str, Any], mount_at: str) -> dict[str, Any]:
    for tree in view["localTrees"]["trees"]:
        if tree["mountAt"] == mount_at:
            return tree
    raise AssertionError(f"view 里没有挂在 {mount_at} 的局部树: {view!r}")


def _page_link(view: dict[str, Any], label: str) -> dict[str, Any]:
    nav = _tree(view, NAV_MOUNT_AT)
    for link in _slots(nav["root"], "dendro:page-link"):
        if link["props"].get("label") == label:
            return link
    raise AssertionError(f"导航里没有 {label!r} 的入口")


def test_slot_view_roundtrip_over_the_socket(tmp_path: Path) -> None:
    async def scenario() -> tuple[dict[str, Any], dict[str, Any], dict[str, Any], dict[str, Any]]:
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
                first = await _request(ws, "2", "ui", "render", {"engine": "slot"})
                plugins = _page_link(first, "插件")
                handler = plugins["events"]["click"]

                switched = await _request(
                    ws, "3", "ui", "event", {"handler": handler, "payload": {}, "engine": "slot"}
                )
                again = await _request(ws, "4", "ui", "render", {"engine": "slot"})
                legacy = await _request(ws, "5", "ui", "render", {})
                return first, switched, again, legacy
        finally:
            await net.stop()

    first, switched, again, legacy = asyncio.run(scenario())

    # 第一份视图：信封 / 页面侧表 / 两棵局部树 / 版本从 1 开始。
    assert first["kind"] == "view"
    assert first["schema"] == "dendro.ui/1"
    assert first["version"] == 1
    assert first["active"] == "page.ideas"
    assert first["data"] == {}
    assert [page["id"] for page in first["pages"]] == ["page.ideas", "page.plugins"]
    assert _tree(first, PAGE_MOUNT_AT)["root"]["id"] == "page.ideas"

    # 点导航：active 换页、页面树换根、版本前进；page-link 的 handler 是真实事件。
    assert switched["kind"] == "view"
    assert switched["active"] == "page.plugins"
    assert switched["version"] == 2
    assert _tree(switched, PAGE_MOUNT_AT)["root"]["id"] == "page.plugins"
    assert _page_link(switched, "灵感")["events"]["click"]

    # 再拉一次仍在当前页，版本继续单调。
    assert again["kind"] == "view"
    assert again["active"] == "page.plugins"
    assert again["version"] == 3

    # legacy 出口不变：不带 engine 的 render 仍是旧快照形状，且不共享 slot 的当前页。
    assert "content" in legacy
    assert "kind" not in legacy
    assert legacy["page"] == "ideas"

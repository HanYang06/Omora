import asyncio
import base64
import json
from datetime import datetime
from pathlib import Path
from typing import Any, cast

from websockets.asyncio.client import ClientConnection, connect

import omora._capture as ideas_capture
from boot import Config, build
from omora.sdk.tree_build import compose

MANIFEST = ("store", "manager", "media", "ui", "audio", "video", "ideas", "net")
SAVED_AT = datetime(2026, 11, 11, 3, 41)
PAGE_MOUNT_AT = "dendro.window.page"
NAV_MOUNT_AT = "dendro.window.nav"


def _find_tree_node(node: dict[str, Any], node_id: str) -> dict[str, Any] | None:
    if node["id"] == node_id:
        return node
    for child in node["layout"]:
        found = _find_tree_node(child, node_id)
        if found is not None:
            return found
    return None


def _as_slot(node: dict[str, Any]) -> dict[str, Any]:
    """V1 节点 → 测试视图节点（kind / props / events / children）。"""
    return {
        "kind": "dendro:" + str(node["kind"]),
        "props": dict(node["settings"]),
        "events": dict(node["on"]),
        "children": [_as_slot(child) for child in node["layout"]],
    }


def _tree_view(payload: dict[str, Any], frame: dict[str, Any] | None = None) -> dict[str, Any]:
    """ui.tree 的构建输入 → 旧 view 形状，测试体只认页面内容。"""
    document = compose(cast(dict[str, Any], payload["base"]), cast(list[Any], payload["partials"]))
    active = str(payload["name"])
    page = _find_tree_node(document["root"], document["active"])
    if page is None:
        raise AssertionError("tree 里没有 active 页")
    navs = [
        _as_slot(cast(dict[str, Any], partial["root"]))
        for partial in cast(list[dict[str, Any]], payload["partials"])
        if partial["source"] == "ui"
    ]
    pages = [
        {
            "id": "page." + str(link["props"]["route"]).strip("/"),
            "label": str(link["props"]["label"]),
        }
        for link in navs
    ]
    return {
        "kind": "view",
        "version": 1 if frame is None or "document" not in frame else int(frame["document"]),
        "frame": frame,
        "active": "page." + active,
        "pages": pages,
        "localTrees": {
            "trees": [
                {
                    "mountAt": NAV_MOUNT_AT,
                    "root": {
                        "kind": "dendro:nav",
                        "props": {},
                        "events": {},
                        "children": navs,
                    },
                },
                {
                    "mountAt": PAGE_MOUNT_AT,
                    "root": {
                        "id": "page." + active,
                        "kind": "dendro:page",
                        "props": {},
                        "events": {},
                        "children": [_as_slot(page["layout"][0])],
                    },
                },
            ]
        },
    }


def _walk(slot: dict[str, Any]) -> list[dict[str, Any]]:
    found = [slot]
    for child in slot["children"]:
        found.extend(_walk(child))
    return found


def _page_root(view: dict[str, Any]) -> dict[str, Any]:
    for tree in cast(list[dict[str, Any]], view["localTrees"]["trees"]):
        if tree["mountAt"] == PAGE_MOUNT_AT:
            return cast(dict[str, Any], tree["root"])
    raise AssertionError(f"view 里没有页面局部树: {view!r}")


def _slots(view: dict[str, Any], kind: str) -> list[dict[str, Any]]:
    return [slot for slot in _walk(_page_root(view)) if slot["kind"] == f"dendro:{kind}"]


def _find(view: dict[str, Any], kind: str, event: str, **props: Any) -> str | None:
    for slot in _slots(view, kind):
        if all(slot["props"].get(key) == value for key, value in props.items()):
            return str(slot["events"][event])
    return None


def _titles(view: dict[str, Any]) -> list[str]:
    return [str(slot["props"]["title"]) for slot in _slots(view, "item")]


def _nav_handler(view: dict[str, Any], label: str) -> str:
    for tree in cast(list[dict[str, Any]], view["localTrees"]["trees"]):
        if tree["mountAt"] != NAV_MOUNT_AT:
            continue
        for link in _walk(tree["root"]):
            if link["kind"] == "dendro:page-link" and link["props"].get("label") == label:
                return str(link["events"]["click"])
    raise AssertionError(f"导航里没有 {label!r}")


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


async def _tree(ws: ClientConnection, frame_id: str, page: str | None = None) -> dict[str, Any]:
    """拉当前页（或指定页）的 V1 构建输入，摊成测试视图。"""
    args = {} if page is None else {"page": page}
    value = await _request(ws, frame_id, "ui", "tree", args)
    assert value["kind"] == "tree", value
    return _tree_view(cast(dict[str, Any], value))


async def _event(
    ws: ClientConnection,
    frame_id: str,
    handler: str,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """发一次 tree_event：回包是 ops（或整树回退），再拉一次树摊成测试视图。"""
    frame = await _request(
        ws, frame_id, "ui", "tree_event", {"handler": handler, "payload": payload or {}}
    )
    assert frame["kind"] in {"ops", "tree"}, frame
    if frame["kind"] == "ops":
        assert frame["document"] == frame["base"] + 1, frame
    value = await _request(ws, frame_id + "t", "ui", "tree", {})
    assert value["kind"] == "tree", value
    return _tree_view(cast(dict[str, Any], value), frame)


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


def _config(tmp_path: Path) -> Config:
    return Config(
        {
            "net": {"port": 0},
            "store": {"path": str(tmp_path / "omora.db")},
            "media": {"root": str(tmp_path / "media")},
        }
    )


def test_clicking_archive_over_the_socket_updates_the_page(tmp_path: Path) -> None:
    async def scenario() -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
        kernel = build(_config(tmp_path), MANIFEST)
        net = kernel.resolve("net")
        port = await net.serve()
        try:
            async with connect(f"ws://127.0.0.1:{port}") as ws:
                empty = await _tree(ws, "1")
                tile = _find(empty, "tile", "click", title="文字")
                assert tile is not None

                pushed = await _event(ws, "2", tile)
                assert pushed["frame"]["kind"] in {"ops", "tree"}

                capture_page = await _tree(ws, "3")
                capture = _find(capture_page, "input", "submit")
                assert capture is not None

                pushed = await _event(ws, "4", capture, {"value": "买牛奶"})
                assert "买牛奶" in json.dumps(pushed, ensure_ascii=False)

                before = await _tree(ws, "5")
                opened = _find(before, "item", "click", title="买牛奶")
                assert opened is not None

                await _event(ws, "6", opened)

                detail = await _tree(ws, "7")
                handler = _find(detail, "button", "click", text="归档")
                assert handler is not None

                await _event(ws, "8", handler)

                after = await _tree(ws, "9")
                return empty, before, after
        finally:
            await net.stop()

    empty, before, after = asyncio.run(scenario())

    assert empty["active"] == "page.ideas"
    assert _titles(before) == ["买牛奶"]
    assert _titles(after) == []
    assert _slots(after, "empty")[0]["props"]["title"] == "还没有灵感。"


def test_switching_pages_over_the_socket_keeps_the_current_page(tmp_path: Path) -> None:
    async def scenario() -> tuple[dict[str, Any], dict[str, Any], dict[str, Any], dict[str, Any]]:
        kernel = build(_config(tmp_path), MANIFEST)
        net = kernel.resolve("net")
        port = await net.serve()
        try:
            async with connect(f"ws://127.0.0.1:{port}") as ws:
                ideas = await _tree(ws, "1")
                plugins = await _tree(ws, "2", "plugins")
                again = await _tree(ws, "3")
                back = await _event(ws, "4", _nav_handler(plugins, "灵感"))
                return ideas, plugins, again, back
        finally:
            await net.stop()

    ideas, plugins, again, back = asyncio.run(scenario())

    assert ideas["active"] == "page.ideas"
    assert plugins["active"] == "page.plugins"
    assert _page_root(plugins)["id"] == "page.plugins"
    assert "page.plugins" in [page["id"] for page in plugins["pages"]]
    assert again["active"] == "page.plugins"
    assert [ideas["active"], plugins["active"], again["active"], back["active"]] == [
        "page.ideas",
        "page.plugins",
        "page.plugins",
        "page.ideas",
    ]


def test_audio_capture_and_media_load_over_the_socket(tmp_path: Path, monkeypatch: Any) -> None:
    # 默认名读的是保存时刻：把捕捉的钟钉住，断言才不会随分钟漂。
    monkeypatch.setattr(ideas_capture, "now", lambda: SAVED_AT)

    async def scenario() -> dict[str, Any]:
        kernel = build(_config(tmp_path), MANIFEST)
        net = kernel.resolve("net")
        port = await net.serve()
        try:
            # 客户端上报能力之后，manager 才把 audio / video 装上。
            kernel.resolve("manager").report_devices(["audioinput", "videoinput"])
            status, payload = await _post(_media_port(net), b"hello", "audio/webm")
            assert status == 201, payload
            audio_id = str(json.loads(payload)["media_id"])
            async with connect(f"ws://127.0.0.1:{port}") as ws:
                before = await _tree(ws, "1")
                tile = _find(before, "tile", "click", title="录音")
                assert tile is not None

                await _event(ws, "2", tile)

                capture_page = await _tree(ws, "3")
                handler = _find(capture_page, "audio_capture", "submit")
                assert handler is not None

                await _event(
                    ws,
                    "4",
                    handler,
                    {"media": audio_id, "mime": "audio/webm", "seconds": 2.0},
                )

                after = await _tree(ws, "5")
                opened = _find(after, "item", "click", title="语音 11-11 03:41")
                assert opened is not None

                await _event(ws, "6", opened)

                detail = await _tree(ws, "7")
                media_id = str(_slots(detail, "audio")[0]["props"]["media"])
                loaded = await _request(ws, "8", "media", "load", {"media_id": media_id})
                assert isinstance(loaded, dict)
                return cast(dict[str, Any], loaded)
        finally:
            await net.stop()

    loaded = asyncio.run(scenario())

    assert loaded["mime"] == "audio/webm"
    assert base64.b64decode(str(loaded["data"])) == b"hello"


def test_video_capture_uploads_over_http_and_plays_back(tmp_path: Path, monkeypatch: Any) -> None:
    monkeypatch.setattr(ideas_capture, "now", lambda: SAVED_AT)

    async def scenario() -> tuple[dict[str, Any], bytes]:
        kernel = build(_config(tmp_path), MANIFEST)
        net = kernel.resolve("net")
        port = await net.serve()
        try:
            kernel.resolve("manager").report_devices(["audioinput", "videoinput"])
            status, payload = await _post(_media_port(net), b"video-bytes", "video/webm")
            assert status == 201, payload
            media_id = str(json.loads(payload)["media_id"])
            async with connect(f"ws://127.0.0.1:{port}") as ws:
                before = await _tree(ws, "1")
                tile = _find(before, "tile", "click", title="视频")
                assert tile is not None

                await _event(ws, "2", tile)

                capture_page = await _tree(ws, "3")
                handler = _find(capture_page, "video_capture", "submit")
                assert handler is not None

                await _event(
                    ws,
                    "4",
                    handler,
                    {"media": media_id, "mime": "video/webm", "seconds": 4},
                )

                after = await _tree(ws, "5")
                opened = _find(after, "item", "click", title="视频 11-11 03:41")
                assert opened is not None

                await _event(ws, "6", opened)

                detail = await _tree(ws, "7")
                src = str(_slots(detail, "video")[0]["props"]["src"])
                fetched = await _get(src)
                return after, fetched
        finally:
            await net.stop()

    after, fetched = asyncio.run(scenario())

    assert _titles(after) == ["视频 11-11 03:41"]
    assert fetched == b"video-bytes"


def test_plugin_inventory_and_toggle_over_the_socket(tmp_path: Path) -> None:
    async def scenario() -> tuple[Any, dict[str, Any], dict[str, Any], dict[str, Any]]:
        kernel = build(_config(tmp_path), MANIFEST)
        net = kernel.resolve("net")
        port = await net.serve()
        try:
            async with connect(f"ws://127.0.0.1:{port}") as ws:
                inventory = await _request(ws, "1", "manager", "inventory", {})
                reported = await _request(
                    ws,
                    "2",
                    "manager",
                    "report_devices",
                    {"devices": ["audioinput"]},
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
    assert reported["devices"] == ["audioinput"]
    after = {row["name"]: row for row in toggled["plugins"]}
    assert after["ideas"]["phase"] == "disabled"
    assert after["ideas"]["reason"]["code"] == "disabled-by-setting"
    assert kernel.running("ideas") is False

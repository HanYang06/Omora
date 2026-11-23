"""空格速记：首页常驻一个热键，按住即录、松手回三个 Tile。

插件侧只验证状态切换；真正的落库发生在引擎卸载捕捉组件时的那次提交，
这里用 tree_event(submit handler, payload) 模拟那一步。
"""

from datetime import datetime
from pathlib import Path
from typing import Any

import omora._capture as capture_page
from omora.audio import AudioPlugin
from omora.core.kernel import Kernel
from omora.ideas import IdeasPlugin
from omora.media import MediaPlugin
from omora.store import StorePlugin
from omora.ui import UiPlugin
from omora.video import VideoPlugin

CHANNEL = "http://127.0.0.1:8766/media"
SAVED_AT = datetime(2026, 11, 11, 3, 41)
PAGE_MOUNT_AT = "dendro.window.page"


class _Net:
    """net 的替身：提供媒体通道地址，吞掉推送。"""

    name = "net"

    def __init__(self, media_url: str = CHANNEL) -> None:
        self.media_url = media_url

    def apply(self, ctx: Any) -> None:
        ctx.provide("net", self)

    def emit(self, topic: str, payload: dict[str, Any], *, coalesce: bool = False) -> None:
        pass


def _kernel(tmp_path: Path, *, captures: bool = True) -> Kernel:
    kernel = Kernel()
    kernel.install(StorePlugin(path=str(tmp_path / "omora.db")))
    kernel.install(MediaPlugin(root=str(tmp_path / "media")))
    kernel.install(UiPlugin())
    if captures:
        kernel.install(AudioPlugin())
        kernel.install(VideoPlugin())
        kernel.install(_Net())
    kernel.install(IdeasPlugin())
    return kernel


def _find_tree_node(node: dict[str, Any], node_id: str) -> dict[str, Any] | None:
    if node["id"] == node_id:
        return node
    for child in node["layout"]:
        found = _find_tree_node(child, node_id)
        if found is not None:
            return found
    for template in node.get("collection", {}).get("templates", {}).values():
        found = _find_tree_node(template, node_id)
        if found is not None:
            return found
    return None


def _as_slot(node: dict[str, Any]) -> dict[str, Any]:
    """V1 节点 → 测试视图节点（kind / props / events / children / collection）。"""
    slot: dict[str, Any] = {
        "kind": "dendro:" + str(node["kind"]),
        "props": dict(node["settings"]),
        "events": dict(node["on"]),
        "children": [_as_slot(child) for child in node["layout"]],
    }
    collection = node.get("collection")
    if isinstance(collection, dict):
        slot["collection"] = {
            **collection,
            "templates": {
                str(name): _as_slot(template)
                for name, template in dict(collection.get("templates", {})).items()
            },
        }
    return slot


def _adapt_tree(ui: Any, frame: dict[str, Any] | None = None) -> dict[str, Any]:
    """把 ui 当前这棵树摊成旧 view 形状，测试体只认页面内容。"""
    document = ui.current_document
    if document is None:
        raise AssertionError("tree 还没构建")
    page = _find_tree_node(document["root"], document["active"])
    if page is None:
        raise AssertionError("tree 里没有 active 页")
    pages = [
        {
            "id": "page." + info.name,
            "label": info.label,
            "route": "/" + info.name,
            "owner": info.owner,
            "icon": info.icon,
        }
        for info in ui.pages()
    ]
    active = ui.active_page
    return {
        "kind": "view",
        "version": (1 if frame is None or "document" not in frame else int(frame["document"])),
        "frame": frame,
        "active": None if active is None else "page." + active,
        "pages": pages,
        "data": dict(document.get("data", {})),
        "localTrees": {
            "trees": [
                {
                    "mountAt": PAGE_MOUNT_AT,
                    "root": {
                        "kind": "dendro:page",
                        "props": {},
                        "events": {},
                        "children": [_as_slot(page["layout"][0])],
                    },
                }
            ]
        },
    }


def _tree_view(ui: Any, page: str | None = None) -> dict[str, Any]:
    """整页兜底：重建当前页（或指定页）。"""
    if page is None:
        ui.tree()
    else:
        ui.tree(page)
    return _adapt_tree(ui)


def _fire(ui: Any, handler: Any, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    """发一次事件：回包是 ops 帧，随后把这次重建的树摊成测试视图。"""
    frame = ui.tree_event(str(handler), payload or {})
    return _adapt_tree(ui, frame)


def _walk(slot: dict[str, Any]) -> list[dict[str, Any]]:
    found = [slot]
    for child in slot["children"]:
        found.extend(_walk(child))
    return found


def _page_root(view: dict[str, Any]) -> dict[str, Any]:
    for tree in view["localTrees"]["trees"]:
        if tree["mountAt"] == PAGE_MOUNT_AT:
            return dict(tree["root"])
    raise AssertionError("view 里没有页面局部树")


def _content(view: dict[str, Any]) -> dict[str, Any]:
    return dict(_page_root(view)["children"][0])


def _kind(slot: dict[str, Any]) -> str:
    return str(slot["kind"]).removeprefix("dendro:")


def _nodes(node: dict[str, Any], node_type: str) -> list[dict[str, Any]]:
    return [slot for slot in _walk(node) if _kind(slot) == node_type]


def _main(view: dict[str, Any]) -> dict[str, Any]:
    main: dict[str, Any] = _content(view)["children"][1]
    return main


def _capture_region(view: dict[str, Any]) -> dict[str, Any]:
    region: dict[str, Any] = _main(view)["children"][1]
    return region


def _tiles(view: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {str(node["props"]["title"]): node for node in _nodes(_main(view), "tile")}


def _texts(node: dict[str, Any]) -> list[str]:
    return [str(child["props"]["text"]) for child in _nodes(node, "text")]


def _data_items(view: dict[str, Any], source: str) -> list[dict[str, Any]]:
    entry = view["data"].get(source)
    if not isinstance(entry, dict):
        return []
    items = entry.get("items")
    return [dict(item) for item in items] if isinstance(items, list) else []


def _cards(view: dict[str, Any]) -> list[str]:
    return [str(item["title"]) for item in _data_items(view, "ideas.feed")]


def _pin_clock(monkeypatch: Any) -> None:
    monkeypatch.setattr(capture_page, "now", lambda: SAVED_AT)


def _audio_take(media_id: str, seconds: float) -> dict[str, Any]:
    return {"media": media_id, "mime": "audio/webm", "seconds": seconds}


def _hotkey(view: dict[str, Any]) -> dict[str, Any]:
    """主区里的那个空格热键：整页只有一个，且不在会被换掉的捕捉区里。"""
    keys = _nodes(_main(view), "hotkey")
    assert len(keys) == 1, f"主区里应恰好有一个 Hotkey，实际 {len(keys)}"
    return keys[0]


def test_the_hotkey_stays_in_the_main_area_while_the_capture_region_changes(
    tmp_path: Path,
) -> None:
    ui = _kernel(tmp_path).resolve("ui")
    home = _tree_view(ui)

    assert _nodes(_capture_region(home), "hotkey") == []
    held = _fire(ui, _hotkey(home)["events"]["press"])

    assert _nodes(_capture_region(held), "hotkey") == []
    assert _hotkey(held)["props"]["key"] == "space"


def test_holding_space_opens_the_audio_workspace_already_recording(tmp_path: Path) -> None:
    ui = _kernel(tmp_path).resolve("ui")
    key = _hotkey(_tree_view(ui))

    held = _fire(ui, key["events"]["press"])

    recorder = _nodes(_main(held), "audio_capture")[0]
    assert recorder["props"]["autostart"] is True
    assert _tiles(held) == {}
    assert _texts(_capture_region(held)) == ["录音"]


def test_releasing_space_folds_the_capture_region_back_to_the_tiles(tmp_path: Path) -> None:
    ui = _kernel(tmp_path).resolve("ui")
    held = _fire(ui, _hotkey(_tree_view(ui))["events"]["press"])

    released = _fire(ui, _hotkey(held)["events"]["release"])

    assert list(_tiles(released)) == ["录音", "视频", "文字"]
    assert _nodes(_main(released), "audio_capture") == []


def test_a_held_take_is_stored_when_the_engine_submits_on_release(
    tmp_path: Path, monkeypatch: Any
) -> None:
    """松手这条按速记处理：只落库、回首页，不出命名条。"""
    _pin_clock(monkeypatch)
    kernel = _kernel(tmp_path)
    ui = kernel.resolve("ui")
    uploaded = str(kernel.resolve("media").save(b"hello", "audio/webm"))
    key = _hotkey(_tree_view(ui))
    held = _fire(ui, key["events"]["press"])
    recorder = _nodes(_main(held), "audio_capture")[0]

    # 引擎手里是上一份视图的 id：松手先画回 Tile，卸载时才提交。宽限期只容一代，
    # 所以这两步中间不能再画，最后才取一次视图断言。
    _fire(ui, _hotkey(held)["events"]["release"])
    _fire(ui, recorder["events"]["submit"], _audio_take(uploaded, 3))
    settled = _tree_view(ui)

    assert list(_tiles(settled)) == ["录音", "视频", "文字"]
    assert _nodes(_main(settled), "input") == []
    assert _cards(settled) == ["语音 11-11 03:41"]


def test_holding_space_without_the_audio_plugin_keeps_the_tiles(tmp_path: Path) -> None:
    ui = _kernel(tmp_path, captures=False).resolve("ui")
    key = _hotkey(_tree_view(ui))

    # 没装 audio：这次按下不改视图，result 仍然是视图，壳没被弄坏。
    after = _fire(ui, key["events"]["press"], {})

    assert list(_tiles(after)) == ["文字"]

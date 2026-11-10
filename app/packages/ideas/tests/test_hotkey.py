"""空格速记：首页常驻一个热键，按住即录、松手回三个 Tile。

插件侧只验证状态切换；真正的落库发生在引擎卸载捕捉组件时的那次提交，
这里用 ui.event(submit handler, payload) 模拟那一步。
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


class _Net:
    name = "net"

    def __init__(self, media_url: str = CHANNEL) -> None:
        self.media_url = media_url

    def apply(self, ctx: Any) -> None:
        ctx.provide("net", self)


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


def _nodes(node: dict[str, Any], node_type: str) -> list[dict[str, Any]]:
    found = [node] if node["type"] == node_type else []
    for child in node["children"]:
        found.extend(_nodes(child, node_type))
    return found


def _main(snapshot: dict[str, Any]) -> dict[str, Any]:
    main: dict[str, Any] = snapshot["content"]["children"][1]
    return main


def _capture_region(snapshot: dict[str, Any]) -> dict[str, Any]:
    """主区第二块：捕捉区（三个 Tile 或工作区）。"""
    region: dict[str, Any] = _main(snapshot)["children"][1]
    return region


def _tiles(snapshot: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {str(node["props"]["title"]): node for node in _nodes(_main(snapshot), "tile")}


def _texts(node: dict[str, Any]) -> list[str]:
    return [str(child["props"]["text"]) for child in _nodes(node, "text")]


def _cards(snapshot: dict[str, Any]) -> list[str]:
    return [str(card["props"]["title"]) for card in _nodes(_main(snapshot), "card")]


def _pin_clock(monkeypatch: Any) -> None:
    monkeypatch.setattr(capture_page, "now", lambda: SAVED_AT)


def _audio_take(media_id: str, seconds: float) -> dict[str, Any]:
    return {"media": media_id, "mime": "audio/webm", "seconds": seconds}


def _hotkey(snapshot: dict[str, Any]) -> dict[str, Any]:
    """主区里的那个空格热键：整页只有一个，且不在会被换掉的捕捉区里。"""
    keys = _nodes(_main(snapshot), "hotkey")
    assert len(keys) == 1, f"主区里应恰好有一个 Hotkey，实际 {len(keys)}"
    return keys[0]


def test_the_hotkey_stays_in_the_main_area_while_the_capture_region_changes(
    tmp_path: Path,
) -> None:
    ui = _kernel(tmp_path).resolve("ui")
    home = ui.render()

    assert _nodes(_capture_region(home), "hotkey") == []
    held = ui.event(str(_hotkey(home)["props"]["on_press"]), {})

    assert _nodes(_capture_region(held), "hotkey") == []
    assert _hotkey(held)["props"]["key"] == "space"


def test_holding_space_opens_the_audio_workspace_already_recording(tmp_path: Path) -> None:
    ui = _kernel(tmp_path).resolve("ui")
    key = _hotkey(ui.render())

    held = ui.event(str(key["props"]["on_press"]), {})

    recorder = _nodes(_main(held), "audio_capture")[0]
    assert recorder["props"]["autostart"] is True
    assert _tiles(held) == {}
    assert _texts(_capture_region(held)) == ["录音"]


def test_releasing_space_folds_the_capture_region_back_to_the_tiles(tmp_path: Path) -> None:
    ui = _kernel(tmp_path).resolve("ui")
    held = ui.event(str(_hotkey(ui.render())["props"]["on_press"]), {})

    released = ui.event(str(_hotkey(held)["props"]["on_release"]), {})

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
    key = _hotkey(ui.render())
    held = ui.event(str(key["props"]["on_press"]), {})
    recorder = _nodes(_main(held), "audio_capture")[0]

    # 引擎手里是按下之前那份快照的 id：松手先画回 Tile，卸载时才提交。
    released = ui.event(str(key["props"]["on_release"]), {})
    settled = ui.event(str(recorder["props"]["on_submit"]), _audio_take(uploaded, 3))

    assert list(_tiles(released)) == ["录音", "视频", "文字"]
    assert list(_tiles(settled)) == ["录音", "视频", "文字"]
    assert _nodes(_main(settled), "input") == []
    assert _cards(settled) == ["语音 11-11 03:41"]
    assert settled["pages"][0]["count"] == 1


def test_holding_space_without_the_audio_plugin_keeps_the_tiles(tmp_path: Path) -> None:
    ui = _kernel(tmp_path, captures=False).resolve("ui")
    key = _hotkey(ui.render())

    after = ui.event(str(key["props"]["on_press"]), {})

    assert list(_tiles(after)) == ["文字"]

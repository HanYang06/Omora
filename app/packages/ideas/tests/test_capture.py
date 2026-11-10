"""捕捉区：点 Tile 就地开工作区，收起回三个 Tile。

工作区不换页：搜索区、索引栏、列表面板都还在，只有捕捉区那一块换了样子。
"""

import base64
from pathlib import Path
from typing import Any

from omora.audio import AudioPlugin
from omora.core.kernel import Kernel
from omora.ideas import IdeasPlugin
from omora.media import MediaPlugin
from omora.store import StorePlugin
from omora.ui import UiPlugin
from omora.video import VideoPlugin

CHANNEL = "http://127.0.0.1:8766/media"


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
    content = snapshot["content"]
    assert content["type"] == "split", f"页面要是 Split，实际是 {content['type']}"
    main: dict[str, Any] = content["children"][1]
    return main


def _rail_titles(snapshot: dict[str, Any]) -> list[str]:
    return [str(row["props"]["title"]) for row in _nodes(snapshot["content"]["children"][0], "item")]


def _cards(snapshot: dict[str, Any]) -> list[str]:
    return [str(card["props"]["title"]) for card in _nodes(_main(snapshot), "card")]


def _tiles(snapshot: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {str(node["props"]["title"]): node for node in _nodes(_main(snapshot), "tile")}


def _capture_region(snapshot: dict[str, Any]) -> dict[str, Any]:
    """主区第二块：捕捉区（三个 Tile 或工作区）。"""
    region: dict[str, Any] = _main(snapshot)["children"][1]
    return region


def _texts(node: dict[str, Any]) -> list[str]:
    return [str(child["props"]["text"]) for child in _nodes(node, "text")]


def _button_texts(node: dict[str, Any]) -> list[str]:
    return [str(child["props"]["text"]) for child in _nodes(node, "button")]


def _click_tile(ui: Any, title: str) -> Any:
    return ui.event(str(_tiles(ui.render())[title]["props"]["on_click"]), {})


def _click_rail(ui: Any, title: str) -> Any:
    rail = ui.render()["content"]["children"][0]
    hits = [row for row in _nodes(rail, "item") if row["props"]["title"] == title]
    assert hits, f"索引栏里没有: {title}"
    return ui.event(str(hits[0]["props"]["on_click"]), {})


def _click_button(ui: Any, text: str) -> Any:
    hits = [node for node in _nodes(_main(ui.render()), "button") if node["props"]["text"] == text]
    assert hits, f"主区里没有按钮: {text}"
    return ui.event(str(hits[0]["props"]["on_click"]), {})


def _recording(ui: Any, tile: str, node_type: str) -> tuple[str, dict[str, Any]]:
    """点 Tile 进工作区，交出录制组件的提交 handler 与节点本身。"""
    _click_tile(ui, tile)
    node = _nodes(_main(ui.render()), node_type)[0]
    return str(node["props"]["on_submit"]), node


def _audio_take(seconds: float) -> dict[str, Any]:
    return {
        "audio": base64.b64encode(b"hello").decode("ascii"),
        "mime": "audio/webm",
        "seconds": seconds,
    }


def _video_take(media_id: str, seconds: float = 5) -> dict[str, Any]:
    return {"media": media_id, "mime": "video/webm", "seconds": seconds}


def test_clicking_a_tile_turns_the_capture_region_into_a_workspace_in_place(
    tmp_path: Path,
) -> None:
    ui = _kernel(tmp_path).resolve("ui")
    _click_tile(ui, "文字")
    field = _nodes(_main(ui.render()), "input")[0]
    ui.event(str(field["props"]["on_submit"]), {"value": "买牛奶"})

    workspace = _click_tile(ui, "录音")

    assert [child["type"] for child in _main(workspace)["children"]] == ["search", "panel", "panel"]
    assert _rail_titles(workspace) == ["买牛奶"]
    assert _nodes(_main(workspace), "tile") == []
    assert _nodes(_main(workspace), "audio_capture")
    assert _texts(_capture_region(workspace)) == ["录音"]
    assert _button_texts(_capture_region(workspace)) == ["收起"]
    assert _cards(workspace) == ["买牛奶"]


def test_the_text_workspace_stores_on_enter_and_folds_back_to_the_tiles(tmp_path: Path) -> None:
    ui = _kernel(tmp_path).resolve("ui")
    workspace = _click_tile(ui, "文字")
    field = _nodes(_main(workspace), "input")[0]
    assert _texts(_capture_region(workspace)) == ["文字"]

    home = ui.event(str(field["props"]["on_submit"]), {"value": "  买牛奶  "})

    assert list(_tiles(home)) == ["录音", "视频", "文字"]
    assert (_cards(home), home["meta"]) == (["买牛奶"], "1 条")


def test_a_blank_text_capture_is_not_stored(tmp_path: Path) -> None:
    ui = _kernel(tmp_path).resolve("ui")
    workspace = _click_tile(ui, "文字")

    field = _nodes(_main(workspace), "input")[0]
    after = ui.event(str(field["props"]["on_submit"]), {"value": "   "})

    assert _nodes(_main(after), "input")
    assert after["pages"][0]["count"] == 0


def test_stopping_a_recording_stores_the_idea_and_folds_back_to_the_tiles(
    tmp_path: Path,
) -> None:
    kernel = _kernel(tmp_path)
    ui = kernel.resolve("ui")
    handler, recorder = _recording(ui, "录音", "audio_capture")
    assert (recorder["props"]["quality"], recorder["props"]["noise_reduction"]) == ("high", True)

    home = ui.event(handler, _audio_take(12.4))

    assert list(_tiles(home)) == ["录音", "视频", "文字"]
    assert _cards(home) == ["语音 0:12"]
    assert _rail_titles(home) == ["语音 0:12"]
    detail = _click_rail(ui, "语音 0:12")
    media_id = str(_nodes(_main(detail), "audio")[0]["props"]["media"])
    assert base64.b64decode(kernel.resolve("media").load(media_id)["data"]) == b"hello"


def test_stopping_a_video_stores_the_idea_and_folds_back_to_the_tiles(tmp_path: Path) -> None:
    kernel = _kernel(tmp_path)
    ui = kernel.resolve("ui")
    uploaded = str(kernel.resolve("media").save(b"video", "video/webm"))
    handler, recorder = _recording(ui, "视频", "video_capture")
    assert (recorder["props"]["quality"], recorder["props"]["upload_url"]) == ("720p", CHANNEL)

    home = ui.event(handler, _video_take(uploaded))

    assert list(_tiles(home)) == ["录音", "视频", "文字"]
    assert _cards(home) == ["视频 0:05"]
    detail = _click_rail(ui, "视频 0:05")
    assert _nodes(_main(detail), "video")[0]["props"] == {
        "media": uploaded,
        "src": f"{CHANNEL}/{uploaded}",
    }


def test_collapsing_the_workspace_goes_back_to_the_three_tiles(tmp_path: Path) -> None:
    ui = _kernel(tmp_path).resolve("ui")
    _click_tile(ui, "录音")

    tiles = _click_button(ui, "收起")

    assert list(_tiles(tiles)) == ["录音", "视频", "文字"]
    assert _nodes(_main(tiles), "audio_capture") == []


def test_a_capture_the_media_plugins_reject_never_reaches_the_store(tmp_path: Path) -> None:
    ui = _kernel(tmp_path).resolve("ui")
    rejects = (
        ("录音", "audio_capture", {"audio": "", "mime": "audio/webm", "seconds": 1}),
        ("视频", "video_capture", {"media": "nope", "mime": "video/webm", "seconds": 1}),
    )

    for tile, node_type, payload in rejects:
        handler, _ = _recording(ui, tile, node_type)

        after = ui.event(handler, payload)

        assert _nodes(_main(after), node_type), tile
        assert after["pages"][0]["count"] == 0, tile
        _click_button(ui, "收起")


def test_the_capture_tiles_follow_the_capture_plugins(tmp_path: Path) -> None:
    """没装 audio / video 只有文字；manager 收到能力上报后装上，Tile 跟着长出来。"""
    kernel = _kernel(tmp_path, captures=False)
    ui = kernel.resolve("ui")
    assert list(_tiles(ui.render())) == ["文字"]

    kernel.install(AudioPlugin())
    kernel.install(VideoPlugin())
    assert list(_tiles(ui.render())) == ["录音", "文字"]

    kernel.install(_Net())
    assert list(_tiles(ui.render())) == ["录音", "视频", "文字"]

"""捕捉区：点 Tile 就地开工作区，收起回三个 Tile。

工作区不换页：搜索区、索引栏、列表面板都还在，只有捕捉区那一块换了样子。
"""

from datetime import datetime
from pathlib import Path
from typing import Any

import pytest

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


_NETS: list[_Net] = []


class _Net:
    """net 的替身：记下推出去的东西，不解释。"""

    name = "net"

    def __init__(self, media_url: str = CHANNEL) -> None:
        self.media_url = media_url
        self.sent: list[tuple[str, dict[str, Any]]] = []
        _NETS.append(self)

    def apply(self, ctx: Any) -> None:
        ctx.provide("net", self)

    def emit(self, topic: str, payload: dict[str, Any], *, coalesce: bool = False) -> None:
        self.sent.append((topic, payload))


def _kernel(tmp_path: Path, *, captures: bool = True) -> Kernel:
    _NETS.clear()
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


def _push() -> dict[str, Any]:
    """最近一次推出去的 ui.snapshot。"""
    assert _NETS, "用例没有装 net 替身"
    assert _NETS[-1].sent, "这次事件没有推 ui.snapshot"
    topic, payload = _NETS[-1].sent[-1]
    assert topic == "ui.snapshot", f"推错了 topic: {topic}"
    return payload


def _fire(ui: Any, handler: Any, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    """发一次事件：result 只有确认，视图走 ui.snapshot；再取全量快照给断言用。"""
    assert ui.event(str(handler), payload or {}) == {}
    _assert_pushed()
    snapshot: dict[str, Any] = ui.render()
    return snapshot


def _fire_raw(ui: Any, handler: Any, payload: dict[str, Any] | None = None) -> None:
    """发事件但不再画：留给"陈旧 handler 只宽限一代"的用例，多画一次就把它作废了。"""
    assert ui.event(str(handler), payload or {}) == {}
    _assert_pushed()


def _assert_pushed() -> None:
    pushed = _push()
    if "content" in pushed:
        assert pushed["version"] >= 1
        return
    assert pushed["version"] > pushed["base"], "补丁的版本必须往上走"
    assert pushed["ops"], "补丁不许是空的"


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
    return [
        str(row["props"]["title"]) for row in _nodes(snapshot["content"]["children"][0], "item")
    ]


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


def _pin_clock(monkeypatch: Any) -> None:
    """钉住捕捉的钟：默认名读的是保存时刻，不是时长。"""
    monkeypatch.setattr(capture_page, "now", lambda: SAVED_AT)


def _click_tile(ui: Any, title: str) -> Any:
    return _fire(ui, _tiles(ui.render())[title]["props"]["on_click"])


def _click_rail(ui: Any, title: str) -> Any:
    rail = ui.render()["content"]["children"][0]
    hits = [row for row in _nodes(rail, "item") if row["props"]["title"] == title]
    assert hits, f"索引栏里没有: {title}"
    return _fire(ui, hits[0]["props"]["on_click"])


def _click_button(ui: Any, text: str) -> Any:
    hits = [node for node in _nodes(_main(ui.render()), "button") if node["props"]["text"] == text]
    assert hits, f"主区里没有按钮: {text}"
    return _fire(ui, hits[0]["props"]["on_click"])


def _recording(ui: Any, tile: str, node_type: str) -> tuple[str, dict[str, Any]]:
    """点 Tile 进工作区，交出录制组件的提交 handler 与节点本身。"""
    _click_tile(ui, tile)
    node = _nodes(_main(ui.render()), node_type)[0]
    return str(node["props"]["on_submit"]), node


def _audio_take(media_id: str, seconds: float) -> dict[str, Any]:
    """引擎交上来的载荷：字节已经在 HTTP 媒体通道里，帧里只有 id 与时长。"""
    return {"media": media_id, "mime": "audio/webm", "seconds": seconds}


def _video_take(media_id: str, seconds: float = 5) -> dict[str, Any]:
    return {"media": media_id, "mime": "video/webm", "seconds": seconds}


def test_clicking_a_tile_turns_the_capture_region_into_a_workspace_in_place(
    tmp_path: Path,
) -> None:
    ui = _kernel(tmp_path).resolve("ui")
    _click_tile(ui, "文字")
    field = _nodes(_main(ui.render()), "input")[0]
    _fire(ui, field["props"]["on_submit"], {"value": "买牛奶"})

    workspace = _click_tile(ui, "录音")

    assert [child["type"] for child in _main(workspace)["children"]] == [
        "search",
        "panel",
        "panel",
        "hotkey",
    ]
    assert _rail_titles(workspace) == ["买牛奶"]
    assert _nodes(_main(workspace), "tile") == []
    assert _nodes(_main(workspace), "audio_capture")[0]["props"].get("autostart") is None, (
        "点 Tile 是手动开录，不该替用户按下录音"
    )
    assert _texts(_capture_region(workspace)) == ["录音"]
    assert _button_texts(_capture_region(workspace)) == ["收起"]
    assert _cards(workspace) == ["买牛奶"]


def test_the_text_workspace_stores_on_enter_and_folds_back_to_the_tiles(tmp_path: Path) -> None:
    ui = _kernel(tmp_path).resolve("ui")
    workspace = _click_tile(ui, "文字")
    field = _nodes(_main(workspace), "input")[0]
    assert _texts(_capture_region(workspace)) == ["文字"]

    home = _fire(ui, field["props"]["on_submit"], {"value": "  买牛奶  "})

    assert list(_tiles(home)) == ["录音", "视频", "文字"]
    assert (_cards(home), home["meta"]) == (["买牛奶"], "1 条")


def test_a_blank_text_capture_is_not_stored(tmp_path: Path) -> None:
    ui = _kernel(tmp_path).resolve("ui")
    workspace = _click_tile(ui, "文字")

    field = _nodes(_main(workspace), "input")[0]
    after = _fire(ui, field["props"]["on_submit"], {"value": "   "})

    assert _nodes(_main(after), "input")
    assert after["pages"][0]["count"] == 0


def test_stopping_a_recording_stores_it_and_leaves_a_saved_bar(
    tmp_path: Path, monkeypatch: Any
) -> None:
    _pin_clock(monkeypatch)
    kernel = _kernel(tmp_path)
    ui = kernel.resolve("ui")
    uploaded = str(kernel.resolve("media").save(b"hello", "audio/webm"))
    handler, recorder = _recording(ui, "录音", "audio_capture")
    assert (recorder["props"]["quality"], recorder["props"]["noise_reduction"]) == ("high", True)

    saved = _fire(ui, handler, _audio_take(uploaded, 12.4))

    bar = _capture_region(saved)
    assert [child["type"] for child in bar["children"]] == ["row", "waveform"]
    assert _nodes(bar, "audio_capture") == []
    assert _texts(bar) == ["已保存 · 0:12"]
    assert _button_texts(bar) == ["再录一条", "收起"]
    assert _nodes(bar, "input")[0]["props"]["value"] == "语音 11-11 03:41"
    assert _nodes(bar, "audio")[0]["props"]["media"] == uploaded
    waveform = _nodes(bar, "waveform")[0]["props"]
    assert waveform["src"] == f"{CHANNEL}/{uploaded}"
    assert _cards(saved) == ["语音 11-11 03:41"]
    assert _rail_titles(saved) == ["语音 11-11 03:41"]
    assert saved["pages"][0]["count"] == 1

    tiles = _click_button(ui, "收起")

    assert list(_tiles(tiles)) == ["录音", "视频", "文字"]
    assert _cards(tiles) == ["语音 11-11 03:41"]


def test_the_saved_bar_records_again_and_collapses_to_the_tiles(
    tmp_path: Path, monkeypatch: Any
) -> None:
    _pin_clock(monkeypatch)
    kernel = _kernel(tmp_path)
    ui = kernel.resolve("ui")
    uploaded = str(kernel.resolve("media").save(b"hello", "audio/webm"))
    handler, _ = _recording(ui, "录音", "audio_capture")
    _fire(ui, handler, _audio_take(uploaded, 3))

    again = _click_button(ui, "再录一条")

    assert _nodes(_capture_region(again), "audio_capture")
    assert _nodes(_capture_region(again), "audio") == []
    assert _texts(_capture_region(again)) == ["录音"]
    assert _cards(again) == ["语音 11-11 03:41"]

    tiles = _click_button(ui, "收起")

    assert list(_tiles(tiles)) == ["录音", "视频", "文字"]
    assert _cards(tiles) == ["语音 11-11 03:41"]


def test_a_saved_video_offers_no_inline_player(tmp_path: Path, monkeypatch: Any) -> None:
    """16:9 全宽塞不进一条：视频只在详情里看。"""
    _pin_clock(monkeypatch)
    kernel = _kernel(tmp_path)
    ui = kernel.resolve("ui")
    uploaded = str(kernel.resolve("media").save(b"video", "video/webm"))
    handler, recorder = _recording(ui, "视频", "video_capture")
    assert (recorder["props"]["quality"], recorder["props"]["upload_url"]) == ("720p", CHANNEL)

    saved = _fire(ui, handler, _video_take(uploaded))

    bar = _capture_region(saved)
    assert [child["type"] for child in bar["children"]] == ["row"]
    assert _nodes(bar, "video") == []
    assert _nodes(bar, "audio") == []
    assert _nodes(bar, "waveform") == []
    assert _texts(bar) == ["已保存 · 0:05"]
    assert _nodes(bar, "input")[0]["props"]["value"] == "视频 11-11 03:41"
    assert _button_texts(bar) == ["再录一条", "收起"]
    assert _cards(saved) == ["视频 11-11 03:41"]

    detail = _click_rail(ui, "视频 11-11 03:41")
    assert _nodes(_main(detail), "video")[0]["props"] == {
        "media": uploaded,
        "src": f"{CHANNEL}/{uploaded}",
    }


def test_the_saved_bar_is_gone_after_a_page_change(tmp_path: Path, monkeypatch: Any) -> None:
    """已保存条不是持久状态：换页再回来就是三个 Tile。"""
    _pin_clock(monkeypatch)
    kernel = _kernel(tmp_path)
    ui = kernel.resolve("ui")
    uploaded = str(kernel.resolve("media").save(b"hello", "audio/webm"))
    handler, _ = _recording(ui, "录音", "audio_capture")
    _fire(ui, handler, _audio_take(uploaded, 3))

    _click_rail(ui, "语音 11-11 03:41")
    home = _click_button(ui, "← 返回")

    assert list(_tiles(home)) == ["录音", "视频", "文字"]
    assert _nodes(home["content"], "audio") == []


def test_collapsing_while_recording_stores_the_take_without_reopening_the_bar(
    tmp_path: Path, monkeypatch: Any
) -> None:
    """录制中点收起：引擎在卸载时停止并提交，带的 id 属于上一代；只落库，别把面板变回来。"""
    _pin_clock(monkeypatch)
    kernel = _kernel(tmp_path)
    ui = kernel.resolve("ui")
    uploaded = str(kernel.resolve("media").save(b"hello", "audio/webm"))
    workspace = _click_tile(ui, "录音")
    # 两个 id 来自同一份快照，就像引擎手里那份；收起之后录制组件才卸载并提交。
    handler = str(_nodes(_main(workspace), "audio_capture")[0]["props"]["on_submit"])
    collapse = str(_nodes(_capture_region(workspace), "button")[0]["props"]["on_click"])

    # 宽限期只容一代：中间不能再画，否则那份旧 id 就作废了。
    _fire_raw(ui, collapse)
    _fire_raw(ui, handler, _audio_take(uploaded, 3))
    settled = ui.render()

    assert _cards(settled) == ["语音 11-11 03:41"]
    assert settled["pages"][0]["count"] == 1
    assert list(_tiles(settled)) == ["录音", "视频", "文字"]
    assert _nodes(settled["content"], "audio") == []
    assert _nodes(_main(settled), "waveform") == []
    assert _nodes(_main(settled), "input") == []


def test_collapsing_the_workspace_goes_back_to_the_three_tiles(tmp_path: Path) -> None:
    ui = _kernel(tmp_path).resolve("ui")
    _click_tile(ui, "录音")

    tiles = _click_button(ui, "收起")

    assert list(_tiles(tiles)) == ["录音", "视频", "文字"]
    assert _nodes(_main(tiles), "audio_capture") == []


def test_a_capture_the_media_plugins_reject_never_reaches_the_store(tmp_path: Path) -> None:
    ui = _kernel(tmp_path).resolve("ui")
    rejects = (
        ("录音", "audio_capture", {"media": "", "mime": "audio/webm", "seconds": 1}),
        ("视频", "video_capture", {"media": "nope", "mime": "video/webm", "seconds": 1}),
    )

    for tile, node_type, payload in rejects:
        handler, _ = _recording(ui, tile, node_type)

        after = _fire(ui, handler, payload)

        assert _nodes(_main(after), node_type), tile
        assert after["pages"][0]["count"] == 0, tile
        _click_button(ui, "收起")


def test_the_capture_tiles_follow_the_capture_plugins_and_the_media_channel(
    tmp_path: Path,
) -> None:
    """没装 audio / video 只有文字；装上插件但没有媒体通道也出不了录制的 Tile。"""
    kernel = _kernel(tmp_path, captures=False)
    ui = kernel.resolve("ui")
    assert list(_tiles(ui.render())) == ["文字"]

    kernel.install(AudioPlugin())
    kernel.install(VideoPlugin())
    assert list(_tiles(ui.render())) == ["文字"]

    kernel.install(_Net())
    assert list(_tiles(ui.render())) == ["录音", "视频", "文字"]


def test_naming_a_saved_take_renames_the_record(tmp_path: Path, monkeypatch: Any) -> None:
    _pin_clock(monkeypatch)
    kernel = _kernel(tmp_path)
    ui = kernel.resolve("ui")
    uploaded = str(kernel.resolve("media").save(b"hello", "audio/webm"))
    handler, _ = _recording(ui, "录音", "audio_capture")
    saved = _fire(ui, handler, _audio_take(uploaded, 3))
    field = _nodes(_capture_region(saved), "input")[0]

    renamed = _fire(ui, field["props"]["on_submit"], {"value": "  买牛奶  "})

    assert _cards(renamed) == ["买牛奶"]
    assert _rail_titles(renamed) == ["买牛奶"]
    bar = _capture_region(renamed)
    assert _texts(bar) == ["已保存 · 0:03"]
    assert _nodes(bar, "input")[0]["props"]["value"] == "买牛奶"
    assert _nodes(bar, "waveform")


def test_a_blank_rename_never_clears_the_title(tmp_path: Path, monkeypatch: Any) -> None:
    _pin_clock(monkeypatch)
    kernel = _kernel(tmp_path)
    ui = kernel.resolve("ui")
    uploaded = str(kernel.resolve("media").save(b"hello", "audio/webm"))
    handler, _ = _recording(ui, "录音", "audio_capture")
    saved = _fire(ui, handler, _audio_take(uploaded, 3))
    field = _nodes(_capture_region(saved), "input")[0]

    blank = _fire(ui, field["props"]["on_submit"], {"value": "   "})
    assert _cards(blank) == ["语音 11-11 03:41"]

    field = _nodes(_capture_region(blank), "input")[0]
    renamed = _fire(ui, field["props"]["on_submit"], {"value": "买牛奶"})
    field = _nodes(_capture_region(renamed), "input")[0]
    cleared = _fire(ui, field["props"]["on_submit"], {"value": ""})

    assert _cards(cleared) == ["买牛奶"]
    assert _nodes(_capture_region(cleared), "input")[0]["props"]["value"] == "买牛奶"


def test_a_take_shorter_than_the_minimum_never_reaches_the_store(
    tmp_path: Path, monkeypatch: Any
) -> None:
    """手滑按一下不落库：不到 0.4 秒就当没录，面板也不变。"""
    _pin_clock(monkeypatch)
    kernel = _kernel(tmp_path)
    ui = kernel.resolve("ui")
    audio_id = str(kernel.resolve("media").save(b"brief", "audio/webm"))
    video_id = str(kernel.resolve("media").save(b"brief", "video/webm"))
    takes = (
        ("录音", "audio_capture", audio_id, _audio_take(audio_id, 0.2)),
        ("视频", "video_capture", video_id, _video_take(video_id, 0.2)),
    )

    for tile, node_type, media_id, payload in takes:
        handler, _ = _recording(ui, tile, node_type)

        after = _fire(ui, handler, payload)

        assert _nodes(_main(after), node_type), tile
        assert _nodes(_main(after), "input") == [], tile
        assert _cards(after) == [], tile
        assert after["pages"][0]["count"] == 0, tile
        # 字节已经传进媒体通道了：丢掉这条就不能留着文件。
        with pytest.raises(LookupError):
            kernel.resolve("media").info(media_id)
        _click_button(ui, "收起")


def test_a_take_over_the_minimum_is_stored(tmp_path: Path, monkeypatch: Any) -> None:
    _pin_clock(monkeypatch)
    kernel = _kernel(tmp_path)
    ui = kernel.resolve("ui")
    uploaded = str(kernel.resolve("media").save(b"half", "audio/webm"))
    handler, _ = _recording(ui, "录音", "audio_capture")

    saved = _fire(ui, handler, _audio_take(uploaded, 0.5))

    assert _cards(saved) == ["语音 11-11 03:41"]
    assert _texts(_capture_region(saved)) == ["已保存 · 0:00"]
    assert kernel.resolve("media").info(uploaded)["mime"] == "audio/webm", (
        "够长的录制要留着，只有太短的才删"
    )

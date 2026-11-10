import base64
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

import omora.ideas as ideas_page
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


def _split(snapshot: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    content = snapshot["content"]
    assert content["type"] == "split", f"页面要是 Split，实际是 {content['type']}"
    side, main = content["children"]
    return side, main


def _rail(snapshot: dict[str, Any]) -> dict[str, Any]:
    side, _ = _split(snapshot)
    assert side["type"] == "rail", f"第一栏要是 Rail，实际是 {side['type']}"
    return side


def _main(snapshot: dict[str, Any]) -> dict[str, Any]:
    return _split(snapshot)[1]


def _titles(node: dict[str, Any], node_type: str) -> list[str]:
    return [str(child["props"]["title"]) for child in _nodes(node, node_type)]


def _rail_titles(snapshot: dict[str, Any]) -> list[str]:
    return _titles(_rail(snapshot), "item")


def _cards(snapshot: dict[str, Any]) -> list[str]:
    return _titles(_main(snapshot), "card")


def _tiles(snapshot: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {str(node["props"]["title"]): node for node in _nodes(_main(snapshot), "tile")}


def _chips(snapshot: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {str(node["props"]["text"]): node for node in _nodes(_main(snapshot), "chip")}


def _active_chips(snapshot: dict[str, Any]) -> list[str]:
    return [text for text, node in _chips(snapshot).items() if node["props"]["active"]]


def _search_node(snapshot: dict[str, Any]) -> dict[str, Any]:
    return _nodes(_main(snapshot), "search")[0]


def _heading(snapshot: dict[str, Any]) -> str:
    headings = [
        node["props"]["text"]
        for node in _nodes(_main(snapshot), "text")
        if node["props"].get("kind") == "title"
    ]
    assert headings, "主区里没有标题"
    return str(headings[0])


def _click_tile(ui: Any, title: str) -> Any:
    return ui.event(str(_tiles(ui.render())[title]["props"]["on_click"]), {})


def _click_chip(ui: Any, text: str) -> Any:
    return ui.event(str(_chips(ui.render())[text]["props"]["on_click"]), {})


def _click_button(ui: Any, text: str) -> Any:
    hits = [
        node for node in _nodes(_main(ui.render()), "button") if node["props"]["text"] == text
    ]
    assert hits, f"主区里没有按钮: {text}"
    return ui.event(str(hits[0]["props"]["on_click"]), {})


def _open_rail(ui: Any, title: str) -> Any:
    hits = [row for row in _nodes(_rail(ui.render()), "item") if row["props"]["title"] == title]
    assert hits, f"索引栏里没有: {title}"
    return ui.event(str(hits[0]["props"]["on_click"]), {})


def _pin(ui: Any, title: str) -> Any:
    _open_rail(ui, title)
    _click_button(ui, "置顶")
    return _click_button(ui, "← 返回")


def _capture_text(ui: Any, value: str) -> Any:
    _click_tile(ui, "文字")
    field = _nodes(_main(ui.render()), "input")[0]
    return ui.event(str(field["props"]["on_submit"]), {"value": value})


def _type(ui: Any, value: str) -> Any:
    return ui.event(str(_search_node(ui.render())["props"]["on_query"]), {"value": value})


def _submit(ui: Any, value: str) -> Any:
    return ui.event(str(_search_node(ui.render())["props"]["on_submit"]), {"value": value})


def test_the_page_is_a_split_of_a_rail_and_a_main_area_with_the_ideas_icon(
    tmp_path: Path,
) -> None:
    snapshot = _kernel(tmp_path).resolve("ui").render()

    side, main = _split(snapshot)

    assert side["props"]["title"] == "全部灵感"
    assert main["type"] == "column"
    assert snapshot["pages"][0] == {
        "name": "ideas",
        "label": "灵感",
        "icon": "ideas",
        "count": 0,
    }


def test_the_home_starts_with_the_capture_tiles_and_an_empty_feed(tmp_path: Path) -> None:
    snapshot = _kernel(tmp_path).resolve("ui").render()

    assert list(_tiles(snapshot)) == ["录音", "视频", "文字"]
    empty = _nodes(_main(snapshot), "empty")[0]["props"]
    assert empty["title"] == "还没有灵感。"
    assert empty["hint"] == "录一段、拍一段，或者写第一条，按回车保存。"
    assert snapshot["meta"] == "0 条"


def test_the_toolbar_lists_the_four_filters_with_all_active(tmp_path: Path) -> None:
    snapshot = _kernel(tmp_path).resolve("ui").render()

    assert list(_chips(snapshot)) == ["全部", "置顶", "最近", "久未打开"]
    assert _active_chips(snapshot) == ["全部"]


def test_the_rail_lists_every_idea_newest_first(tmp_path: Path) -> None:
    ui = _kernel(tmp_path).resolve("ui")
    for title in ("牛奶 A", "牛奶 B", "写周报"):
        _capture_text(ui, title)

    assert _rail_titles(ui.render()) == ["写周报", "牛奶 B", "牛奶 A"]


def test_the_rail_only_navigates_and_carries_no_actions(tmp_path: Path) -> None:
    ui = _kernel(tmp_path).resolve("ui")
    _capture_text(ui, "买牛奶")

    rail = _rail(ui.render())

    assert _nodes(rail, "button") == []
    assert _nodes(rail, "item")[0]["props"]["on_click"]


def test_clicking_a_rail_row_opens_the_detail_and_back_returns_home(tmp_path: Path) -> None:
    ui = _kernel(tmp_path).resolve("ui")
    _capture_text(ui, "买牛奶")

    detail = _open_rail(ui, "买牛奶")
    assert _heading(detail) == "买牛奶"

    home = _click_button(ui, "← 返回")
    assert _cards(home) == ["买牛奶"]


def test_the_text_tile_opens_a_capture_page_and_saves_back_home(tmp_path: Path) -> None:
    ui = _kernel(tmp_path).resolve("ui")

    capture = _click_tile(ui, "文字")

    assert _nodes(_main(capture), "input")
    assert _nodes(_main(capture), "tile") == []
    assert _nodes(_main(capture), "card") == []
    assert _nodes(_rail(capture), "item") == []

    field = _nodes(_main(capture), "input")[0]
    home = ui.event(str(field["props"]["on_submit"]), {"value": "  买牛奶  "})

    assert _cards(home) == ["买牛奶"]
    assert _rail_titles(home) == ["买牛奶"]
    assert home["meta"] == "1 条"


def test_a_blank_text_capture_is_not_stored(tmp_path: Path) -> None:
    ui = _kernel(tmp_path).resolve("ui")
    _click_tile(ui, "文字")

    field = _nodes(_main(ui.render()), "input")[0]
    after = ui.event(str(field["props"]["on_submit"]), {"value": "   "})

    assert _nodes(_main(after), "input")
    assert after["pages"][0]["count"] == 0


def test_the_audio_tile_opens_the_audio_capture_and_saves_a_voice_idea(tmp_path: Path) -> None:
    kernel = _kernel(tmp_path)
    ui = kernel.resolve("ui")
    audio = base64.b64encode(b"hello").decode("ascii")

    capture = _click_tile(ui, "录音")
    recorder = _nodes(_main(capture), "audio_capture")[0]
    assert (recorder["props"]["quality"], recorder["props"]["noise_reduction"]) == ("high", True)

    home = ui.event(
        str(recorder["props"]["on_submit"]),
        {"audio": audio, "mime": "audio/webm", "seconds": 3.2},
    )

    assert _cards(home) == ["语音 0:03"]
    detail = _open_rail(ui, "语音 0:03")
    media_id = str(_nodes(_main(detail), "audio")[0]["props"]["media"])
    assert base64.b64decode(kernel.resolve("media").load(media_id)["data"]) == b"hello"


def test_the_video_tile_opens_the_video_capture_and_saves_a_video_idea(tmp_path: Path) -> None:
    kernel = _kernel(tmp_path)
    ui = kernel.resolve("ui")
    uploaded = kernel.resolve("media").save(b"video", "video/webm")

    capture = _click_tile(ui, "视频")
    recorder = _nodes(_main(capture), "video_capture")[0]
    assert (recorder["props"]["quality"], recorder["props"]["upload_url"]) == ("720p", CHANNEL)

    home = ui.event(
        str(recorder["props"]["on_submit"]),
        {"media": uploaded, "mime": "video/webm", "seconds": 5},
    )

    assert _cards(home) == ["视频 0:05"]
    detail = _open_rail(ui, "视频 0:05")
    assert _nodes(_main(detail), "video")[0]["props"] == {
        "media": uploaded,
        "src": f"{CHANNEL}/{uploaded}",
    }


def test_a_capture_the_media_plugins_reject_never_reaches_the_store(tmp_path: Path) -> None:
    ui = _kernel(tmp_path).resolve("ui")
    rejects = (
        ("录音", "audio_capture", {"audio": "", "mime": "audio/webm", "seconds": 1}),
        ("视频", "video_capture", {"media": "nope", "mime": "video/webm", "seconds": 1}),
    )

    for tile, node_type, payload in rejects:
        _click_tile(ui, tile)
        recorder = _nodes(_main(ui.render()), node_type)[0]
        after = ui.event(str(recorder["props"]["on_submit"]), payload)

        assert _nodes(_main(after), node_type), tile
        assert after["pages"][0]["count"] == 0, tile
        _click_button(ui, "← 返回")


def test_without_the_capture_plugins_only_the_text_tile_is_offered(tmp_path: Path) -> None:
    snapshot = _kernel(tmp_path, captures=False).resolve("ui").render()

    assert list(_tiles(snapshot)) == ["文字"]


def test_the_capture_tiles_grow_when_the_plugins_install_later(tmp_path: Path) -> None:
    """manager 收到能力上报后才装 audio / video：页面得跟着长出对应的 Tile。"""
    kernel = _kernel(tmp_path, captures=False)
    ui = kernel.resolve("ui")
    assert list(_tiles(ui.render())) == ["文字"]

    kernel.install(AudioPlugin())
    kernel.install(VideoPlugin())
    assert list(_tiles(ui.render())) == ["录音", "文字"]

    kernel.install(_Net())
    assert list(_tiles(ui.render())) == ["录音", "视频", "文字"]


def test_the_feed_is_newest_first_and_pinning_moves_a_card_to_the_top(tmp_path: Path) -> None:
    ui = _kernel(tmp_path).resolve("ui")
    for title in ("牛奶 A", "牛奶 B", "写周报"):
        _capture_text(ui, title)

    assert _cards(ui.render()) == ["写周报", "牛奶 B", "牛奶 A"]

    home = _pin(ui, "牛奶 A")

    assert _cards(home) == ["牛奶 A", "写周报", "牛奶 B"]
    assert _rail_titles(home) == ["牛奶 A", "写周报", "牛奶 B"]


def test_the_pinned_chip_keeps_only_pinned_ideas(tmp_path: Path) -> None:
    ui = _kernel(tmp_path).resolve("ui")
    _capture_text(ui, "牛奶 A")
    _capture_text(ui, "牛奶 B")
    _pin(ui, "牛奶 A")

    snapshot = _click_chip(ui, "置顶")

    assert _cards(snapshot) == ["牛奶 A"]
    assert _active_chips(snapshot) == ["置顶"]


def test_the_recent_and_stale_chips_split_the_feed_by_age(
    tmp_path: Path, monkeypatch: Any
) -> None:
    ui = _kernel(tmp_path).resolve("ui")
    _capture_text(ui, "牛奶 A")
    _capture_text(ui, "牛奶 B")

    assert _cards(_click_chip(ui, "最近")) == ["牛奶 B", "牛奶 A"]

    later = datetime.now() + timedelta(days=40)
    monkeypatch.setattr(ideas_page, "now", lambda: later)

    recent = _click_chip(ui, "最近")
    stale = _click_chip(ui, "久未打开")

    assert _cards(recent) == []
    assert _nodes(_main(recent), "empty")[0]["props"]["title"] == "最近 30 天没有新灵感。"
    assert _cards(stale) == ["牛奶 B", "牛奶 A"]
    assert _active_chips(stale) == ["久未打开"]

def test_the_detail_carries_the_pin_state_it_can_undo(tmp_path: Path) -> None:
    ui = _kernel(tmp_path).resolve("ui")
    _capture_text(ui, "买牛奶")
    _open_rail(ui, "买牛奶")

    detail = _click_button(ui, "置顶")

    assert [node["props"]["text"] for node in _nodes(_main(detail), "button")] == [
        "← 返回",
        "取消置顶",
        "归档",
    ]
    assert detail["meta"] == "置顶"


def test_archiving_from_the_detail_takes_the_idea_out_of_the_page(tmp_path: Path) -> None:
    ui = _kernel(tmp_path).resolve("ui")
    _capture_text(ui, "牛奶 A")
    _capture_text(ui, "牛奶 B")
    _open_rail(ui, "牛奶 A")

    home = _click_button(ui, "归档")

    assert _cards(home) == ["牛奶 B"]
    assert _rail_titles(home) == ["牛奶 B"]
    assert home["meta"] == "1 条"


def test_the_nav_count_follows_the_list(tmp_path: Path) -> None:
    ui = _kernel(tmp_path).resolve("ui")

    home = _capture_text(ui, "买牛奶")

    assert home["pages"][0]["label"] == "灵感"
    assert home["pages"][0]["count"] == 1


def test_typing_offers_suggestions_and_enter_moves_to_the_results(tmp_path: Path) -> None:
    ui = _kernel(tmp_path).resolve("ui")
    _capture_text(ui, "买牛奶")
    _capture_text(ui, "牛奶要冷的")
    _capture_text(ui, "写周报")

    typed = _type(ui, "牛奶")

    assert _titles(_main(typed), "suggestion") == ["牛奶要冷的", "买牛奶"]
    assert _nodes(_main(typed), "result") == []
    assert _rail_titles(typed) == ["写周报", "牛奶要冷的", "买牛奶"]

    results = _submit(ui, "牛奶")

    assert _titles(_main(results), "result") == ["牛奶要冷的", "买牛奶"]
    assert results["meta"] == "2 条结果"
    assert _search_node(results)["props"]["value"] == "牛奶"
    assert _rail_titles(results) == ["写周报", "牛奶要冷的", "买牛奶"]


def test_the_dropdown_keeps_at_most_five_suggestions(tmp_path: Path) -> None:
    ui = _kernel(tmp_path).resolve("ui")
    for index in range(7):
        _capture_text(ui, f"牛奶 {index}")

    assert len(_titles(_main(_type(ui, "牛奶")), "suggestion")) == 5


def test_a_query_without_matches_offers_nothing_and_shows_the_empty_state(
    tmp_path: Path,
) -> None:
    ui = _kernel(tmp_path).resolve("ui")
    _capture_text(ui, "买牛奶")

    typed = _type(ui, "牛排")
    assert _titles(_main(typed), "suggestion") == []
    assert _nodes(_main(typed), "result") == []

    after = _submit(ui, "牛排")
    assert after["meta"] == "没有结果"
    assert _nodes(_main(after), "empty")[0]["props"]["title"] == "没有匹配的灵感。"


def test_back_from_the_results_returns_home(tmp_path: Path) -> None:
    ui = _kernel(tmp_path).resolve("ui")
    _capture_text(ui, "买牛奶")
    _submit(ui, "牛奶")

    home = _click_button(ui, "← 返回")

    assert _cards(home) == ["买牛奶"]
    assert _nodes(_main(home), "result") == []


def test_clicking_a_result_opens_the_detail_and_back_walks_home(tmp_path: Path) -> None:
    ui = _kernel(tmp_path).resolve("ui")
    _capture_text(ui, "买牛奶")
    results = _submit(ui, "牛奶")
    hit = _nodes(_main(results), "result")[0]

    detail = ui.event(str(hit["props"]["on_click"]), {})
    assert _heading(detail) == "买牛奶"

    back_to_results = _click_button(ui, "← 返回")
    assert _titles(_main(back_to_results), "result") == ["买牛奶"]

    home = _click_button(ui, "← 返回")
    assert _cards(home) == ["买牛奶"]
    assert _search_node(home)["props"]["value"] == "牛奶"


def test_a_result_carries_the_snippet_the_time_and_the_media_kind(tmp_path: Path) -> None:
    kernel = _kernel(tmp_path)
    ui = kernel.resolve("ui")
    _capture_text(ui, "买牛奶")

    hit = _nodes(_main(_submit(ui, "牛奶")), "result")[0]["props"]
    assert (hit["snippet"], hit["highlight"], hit["meta"]) == ("买牛奶", "牛奶", "刚刚")

    _click_button(ui, "← 返回")
    uploaded = kernel.resolve("media").save(b"video", "video/webm")
    _click_tile(ui, "视频")
    recorder = _nodes(_main(ui.render()), "video_capture")[0]
    ui.event(
        str(recorder["props"]["on_submit"]),
        {"media": uploaded, "mime": "video/webm", "seconds": 5},
    )

    marker = _nodes(_main(_submit(ui, "视频")), "result")[0]["props"]["meta"]
    assert marker == "刚刚 · 视频"


def test_archived_ideas_drop_out_of_the_results(tmp_path: Path) -> None:
    ui = _kernel(tmp_path).resolve("ui")
    _capture_text(ui, "买牛奶")
    _capture_text(ui, "牛奶要冷的")
    _open_rail(ui, "牛奶要冷的")
    _click_button(ui, "归档")

    assert _titles(_main(_submit(ui, "牛奶")), "result") == ["买牛奶"]



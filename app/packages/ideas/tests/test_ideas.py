import base64
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from omora.core.kernel import Kernel
from omora.ideas import IdeasPlugin, _snippet, _when
from omora.media import MediaPlugin
from omora.store import StorePlugin
from omora.ui import UiPlugin


def _kernel(tmp_path: Path) -> Kernel:
    kernel = Kernel()
    kernel.install(StorePlugin(path=str(tmp_path / "omora.db")))
    kernel.install(MediaPlugin(root=str(tmp_path / "media")))
    kernel.install(UiPlugin())
    kernel.install(IdeasPlugin())
    return kernel


def _nodes(node: dict[str, Any], node_type: str) -> list[dict[str, Any]]:
    found = [node] if node["type"] == node_type else []
    for child in node["children"]:
        found.extend(_nodes(child, node_type))
    return found


def _handler(snapshot: dict[str, Any], node_type: str) -> str:
    return str(_nodes(snapshot["content"], node_type)[0]["props"]["on_submit"])


def _titles(snapshot: dict[str, Any]) -> list[str]:
    return [str(item["props"]["title"]) for item in _nodes(snapshot["content"], "item")]


def _props(snapshot: dict[str, Any], node_type: str) -> dict[str, Any]:
    return dict(_nodes(snapshot["content"], node_type)[0]["props"])


def _capture(ui: Any, value: str) -> Any:
    return ui.event(_handler(ui.render(), "input"), {"value": value})


def _type(ui: Any, value: str) -> Any:
    return ui.event(str(_props(ui.render(), "search")["on_query"]), {"value": value})


def _submit(ui: Any, value: str) -> Any:
    return ui.event(str(_props(ui.render(), "search")["on_submit"]), {"value": value})


def _titled(snapshot: dict[str, Any], node_type: str) -> list[str]:
    return [str(node["props"]["title"]) for node in _nodes(snapshot["content"], node_type)]


def _button(snapshot: dict[str, Any], text: str) -> str:
    for node in _nodes(snapshot["content"], "button"):
        if node["props"]["text"] == text:
            return str(node["props"]["on_click"])
    raise AssertionError(f"没有按钮: {text}")


def _item_button(snapshot: dict[str, Any], index: int, text: str) -> str:
    item = _nodes(snapshot["content"], "item")[index]
    for node in _nodes(item, "button"):
        if node["props"]["text"] == text:
            return str(node["props"]["on_click"])
    raise AssertionError(f"第 {index} 行没有按钮: {text}")


def _result_click(snapshot: dict[str, Any]) -> str:
    return str(_nodes(snapshot["content"], "result")[0]["props"]["on_click"])


def test_the_page_starts_empty(tmp_path: Path) -> None:
    snapshot = _kernel(tmp_path).resolve("ui").render()

    assert snapshot["meta"] == "0 条"
    assert _titles(snapshot) == []
    empty = _nodes(snapshot["content"], "empty")[0]
    assert empty["props"]["title"] == "还没有灵感。"
    assert empty["props"]["hint"] == "录一段，或者写第一条，按回车保存。"


def test_capturing_text_puts_it_in_the_list(tmp_path: Path) -> None:
    ui = _kernel(tmp_path).resolve("ui")

    after = ui.event(_handler(ui.render(), "input"), {"value": "  买牛奶  "})

    assert after["meta"] == "1 条"
    assert _titles(after) == ["买牛奶"]


def test_capturing_audio_stores_media_and_shows_a_play_button(tmp_path: Path) -> None:
    kernel = _kernel(tmp_path)
    ui = kernel.resolve("ui")
    audio = base64.b64encode(b"hello").decode("ascii")

    after = ui.event(
        _handler(ui.render(), "recorder"),
        {"audio": audio, "mime": "audio/webm", "seconds": 3.2},
    )

    assert after["meta"] == "1 条"
    assert _titles(after) == ["语音 0:03"]
    media_id = str(_nodes(after["content"], "audio")[0]["props"]["media"])
    loaded = kernel.resolve("media").load(media_id)
    assert loaded["mime"] == "audio/webm"
    assert base64.b64decode(loaded["data"]) == b"hello"


def test_a_blank_capture_is_ignored(tmp_path: Path) -> None:
    ui = _kernel(tmp_path).resolve("ui")

    after = ui.event(_handler(ui.render(), "input"), {"value": "   "})

    assert after["meta"] == "0 条"
    assert _titles(after) == []


def test_archiving_a_line_takes_it_out(tmp_path: Path) -> None:
    ui = _kernel(tmp_path).resolve("ui")
    captured = _capture(ui, "买牛奶")
    archive = _button(captured, "归档")

    after = ui.event(archive, {})

    assert after["meta"] == "0 条"
    assert _titles(after) == []


def test_the_nav_count_follows_the_list(tmp_path: Path) -> None:
    ui = _kernel(tmp_path).resolve("ui")

    after = ui.event(_handler(ui.render(), "input"), {"value": "买牛奶"})

    assert after["pages"][0]["label"] == "灵感"
    assert after["pages"][0]["count"] == 1


def test_typing_lists_the_top_matches_as_suggestions(tmp_path: Path) -> None:
    ui = _kernel(tmp_path).resolve("ui")
    _capture(ui, "买牛奶")
    _capture(ui, "牛奶要冷的")
    _capture(ui, "写周报")

    after = _type(ui, "牛奶")

    assert _titled(after, "suggestion") == ["牛奶要冷的", "买牛奶"]
    assert _nodes(after["content"], "result") == []


def test_the_dropdown_keeps_at_most_five_suggestions(tmp_path: Path) -> None:
    ui = _kernel(tmp_path).resolve("ui")
    for index in range(7):
        _capture(ui, f"牛奶 {index}")

    after = _type(ui, "牛奶")

    assert len(_titled(after, "suggestion")) == 5


def test_a_query_without_matches_lists_no_suggestions(tmp_path: Path) -> None:
    ui = _kernel(tmp_path).resolve("ui")
    _capture(ui, "买牛奶")

    after = _type(ui, "牛排")

    assert _titled(after, "suggestion") == []
    assert _nodes(after["content"], "result") == []


def test_enter_shows_the_results_view_and_keeps_the_index(tmp_path: Path) -> None:
    ui = _kernel(tmp_path).resolve("ui")
    _capture(ui, "买牛奶")
    _capture(ui, "写周报")

    after = _submit(ui, "牛奶")

    assert after["meta"] == "1 条结果"
    assert _titled(after, "result") == ["买牛奶"]
    assert _nodes(after["content"], "item") == []
    assert after["pages"][0]["count"] == 2
    assert _props(after, "search")["value"] == "牛奶"


def test_a_result_carries_the_matched_snippet_and_the_time(tmp_path: Path) -> None:
    ui = _kernel(tmp_path).resolve("ui")
    _capture(ui, "买牛奶")

    after = _submit(ui, "牛奶")

    result = _nodes(after["content"], "result")[0]["props"]
    assert result["snippet"] == "买牛奶"
    assert result["highlight"] == "牛奶"
    assert result["meta"] == "刚刚"


def test_a_query_without_matches_shows_the_empty_state(tmp_path: Path) -> None:
    ui = _kernel(tmp_path).resolve("ui")
    _capture(ui, "买牛奶")

    after = _submit(ui, "牛排")

    assert after["meta"] == "没有结果"
    assert _titled(after, "result") == []
    empty = _nodes(after["content"], "empty")[0]["props"]
    assert empty["title"] == "没有匹配的灵感。"


def test_clicking_a_result_opens_the_detail_and_back_walks_home(tmp_path: Path) -> None:
    ui = _kernel(tmp_path).resolve("ui")
    _capture(ui, "买牛奶")
    _capture(ui, "写周报")
    results = _submit(ui, "牛奶")

    detail = ui.event(_result_click(results), {})

    headings = [
        node["props"]["text"]
        for node in _nodes(detail["content"], "text")
        if node["props"].get("kind") == "title"
    ]
    assert headings == ["买牛奶"]

    back_to_results = ui.event(_button(detail, "← 返回"), {})
    assert _titled(back_to_results, "result") == ["买牛奶"]

    home = ui.event(_button(back_to_results, "← 返回"), {})
    assert _props(home, "search")["value"] == "牛奶"
    assert _titles(home) == ["买牛奶", "写周报"]


def test_a_voice_result_can_be_played_from_the_detail(tmp_path: Path) -> None:
    kernel = _kernel(tmp_path)
    ui = kernel.resolve("ui")
    audio = base64.b64encode(b"hello").decode("ascii")
    ui.event(
        _handler(ui.render(), "recorder"),
        {"audio": audio, "mime": "audio/webm", "seconds": 3.2},
    )
    results = _submit(ui, "语音")

    detail = ui.event(_result_click(results), {})

    media_id = str(_nodes(detail["content"], "audio")[0]["props"]["media"])
    assert base64.b64decode(kernel.resolve("media").load(media_id)["data"]) == b"hello"


def test_archived_ideas_drop_out_of_the_results(tmp_path: Path) -> None:
    ui = _kernel(tmp_path).resolve("ui")
    _capture(ui, "买牛奶")
    after = _capture(ui, "牛奶要冷的")
    ui.event(_item_button(after, 1, "归档"), {})

    after = _submit(ui, "牛奶")

    assert _titled(after, "result") == ["买牛奶"]


def test_pinning_ranks_an_older_idea_first(tmp_path: Path) -> None:
    ui = _kernel(tmp_path).resolve("ui")
    _capture(ui, "牛奶 A")
    after = _capture(ui, "牛奶 B")
    pinned = ui.event(_item_button(after, 0, "置顶"), {})

    assert _item_button(pinned, 0, "取消置顶")
    after = _submit(ui, "牛奶")

    assert _titled(after, "result") == ["牛奶 A", "牛奶 B"]
    assert _nodes(after["content"], "result")[0]["props"]["meta"].startswith("置顶")


def test_submitting_a_blank_query_goes_home(tmp_path: Path) -> None:
    ui = _kernel(tmp_path).resolve("ui")
    _capture(ui, "买牛奶")
    _submit(ui, "牛奶")

    after = _submit(ui, "")

    assert after["meta"] == "1 条"
    assert _titled(after, "result") == []
    assert _nodes(after["content"], "input")


def test_snippets_cut_a_window_around_the_match() -> None:
    title = "开头" * 20 + "牛奶" + "结尾" * 20

    snippet = _snippet(title, "牛奶")

    assert "牛奶" in snippet
    assert len(snippet) <= 42
    assert snippet.startswith("…")
    assert snippet.endswith("…")
    assert _snippet("买牛奶", "牛奶") == "买牛奶"
    assert _snippet("写周报", "牛奶") == "写周报"
    assert _snippet("很短" * 30, "牛奶") == ("很短" * 30)[:40] + "…"


def test_relative_time_reads_like_a_ledger() -> None:
    now = datetime(2026, 11, 9, 12, 0)

    assert _when(now - timedelta(seconds=20), now) == "刚刚"
    assert _when(now - timedelta(minutes=5), now) == "5 分钟前"
    assert _when(now - timedelta(hours=3), now) == "3 小时前"
    assert _when(now - timedelta(days=1), now) == "昨天"
    assert _when(now - timedelta(days=3), now) == "周五"
    assert _when(now - timedelta(days=20), now) == "10 月 20 日"

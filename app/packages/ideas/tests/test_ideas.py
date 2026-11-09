import base64
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from omora.core.kernel import Kernel
from omora.plugins.ideas import IdeasPlugin, _when
from omora.plugins.media import MediaPlugin
from omora.plugins.store import StorePlugin
from omora.plugins.ui import UiPlugin


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
    captured = ui.event(_handler(ui.render(), "input"), {"value": "买牛奶"})
    archive = _nodes(captured["content"], "button")[0]["props"]["on_click"]

    after = ui.event(str(archive), {})

    assert after["meta"] == "0 条"
    assert _titles(after) == []


def test_the_nav_count_follows_the_list(tmp_path: Path) -> None:
    ui = _kernel(tmp_path).resolve("ui")

    after = ui.event(_handler(ui.render(), "input"), {"value": "买牛奶"})

    assert after["pages"][0]["label"] == "灵感"
    assert after["pages"][0]["count"] == 1


def test_relative_time_reads_like_a_ledger() -> None:
    now = datetime(2026, 11, 9, 12, 0)

    assert _when(now - timedelta(seconds=20), now) == "刚刚"
    assert _when(now - timedelta(minutes=5), now) == "5 分钟前"
    assert _when(now - timedelta(hours=3), now) == "3 小时前"
    assert _when(now - timedelta(days=1), now) == "昨天"
    assert _when(now - timedelta(days=3), now) == "周五"
    assert _when(now - timedelta(days=20), now) == "10 月 20 日"

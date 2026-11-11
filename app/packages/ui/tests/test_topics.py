"""订阅声明：页面说它要订什么，快照里写清楚，客户端照着订。"""

from __future__ import annotations

import pytest

from omora.core.context import Context
from omora.sdk.ui import Column, Page, Text
from omora.ui import Ui


def _ui() -> tuple[Ui, Context, Context]:
    ui = Ui()
    page_ctx = Context(name="notes")
    topics_ctx = Context(name="audio")
    ui.page(page_ctx, "notes", "笔记", lambda: Page(Column(Text("一行"))))
    return ui, page_ctx, topics_ctx


def test_no_extra_topics_keeps_the_snapshot_shape() -> None:
    ui, _, _ = _ui()

    assert "topics" not in ui.render("notes")


def test_extra_topics_are_declared_in_the_snapshot() -> None:
    ui, _, topics_ctx = _ui()
    ui.topics(topics_ctx, "audio.peaks")

    assert ui.render("notes")["topics"] == ["ui.snapshot", "audio.peaks"]


def test_disposing_the_plugin_drops_its_topic() -> None:
    ui, _, topics_ctx = _ui()
    ui.topics(topics_ctx, "audio.peaks")
    topics_ctx.dispose()

    assert "topics" not in ui.render("notes")


def test_an_empty_topic_is_rejected() -> None:
    ui, _, topics_ctx = _ui()

    with pytest.raises(ValueError, match="topic 不能是空串"):
        ui.topics(topics_ctx, " ")

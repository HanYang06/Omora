"""ideas：灵感页。

捕捉：录音或打字；列表：账本；动作：播放、归档。
不 import 别的插件；store / media / ui 都按服务名取。
"""

from __future__ import annotations

import base64
from datetime import datetime
from typing import Any

from omora.sdk import Context
from omora.sdk.ui import (
    Audio,
    Button,
    Column,
    Empty,
    Handler,
    Input,
    Item,
    List,
    Node,
    Page,
    Recorder,
)

_WEEKDAYS = ("周一", "周二", "周三", "周四", "周五", "周六", "周日")


class IdeasPlugin:
    name = "ideas"

    def apply(self, ctx: Context) -> None:
        store: Any = ctx.resolve("store")
        media: Any = ctx.resolve("media")
        ui: Any = ctx.resolve("ui")
        ideas = store.collection(
            "ideas",
            fields={"title": "text", "archived": "bool", "media": "text?"},
            indexes=["archived"],
        )

        def capture_text(payload: dict[str, Any]) -> None:
            value = str(payload.get("value", "")).strip()
            if value:
                ideas.add(title=value, archived=False, media=None)

        def capture_audio(payload: dict[str, Any]) -> None:
            encoded = str(payload.get("audio", ""))
            if not encoded:
                return
            try:
                data = base64.b64decode(encoded, validate=True)
            except ValueError:
                return
            seconds = float(payload.get("seconds", 0) or 0)
            mime = str(payload.get("mime", "audio/webm"))
            media_id = media.save(data, mime)
            ideas.add(
                title=f"语音 {_clock(seconds)}" if seconds else "语音",
                archived=False,
                media=media_id,
            )

        def build() -> Page:
            items = ideas.find({"archived": False}, order="created_at", limit=200)
            body: Node = (
                _list(items, ideas)
                if items
                else Empty("还没有灵感。", "录一段，或者写第一条，按回车保存。")
            )
            return Page(
                content=Column(
                    Recorder(on_submit=capture_audio),
                    Input(placeholder="记一条灵感…", on_submit=capture_text),
                    body,
                ),
                meta=f"{len(items)} 条",
            )

        ui.page(ctx, "ideas", "灵感", build, count=lambda: ideas.count({"archived": False}))


def _list(items: list[Any], ideas: Any) -> List:
    return List(*[Item(_when(item.created_at), item.title, *_actions(item, ideas)) for item in items])


def _actions(item: Any, ideas: Any) -> list[Node]:
    actions: list[Node] = []
    if item.media:
        actions.append(Audio(media=str(item.media)))
    actions.append(Button("归档", variant="ghost", on_click=_archiver(ideas, item.id)))
    return actions


def _archiver(ideas: Any, record_id: str) -> Handler:
    def run(payload: dict[str, Any]) -> None:
        ideas.update(record_id, archived=True)

    return run


def _when(created: datetime, now: datetime | None = None) -> str:
    """把时间写成账本左栏那一句话。"""
    moment = now or datetime.now()
    seconds = (moment - created).total_seconds()
    if seconds < 60:
        return "刚刚"
    if seconds < 3600:
        return f"{int(seconds // 60)} 分钟前"
    if created.date() == moment.date():
        return f"{int(seconds // 3600)} 小时前"
    days = (moment.date() - created.date()).days
    if days == 1:
        return "昨天"
    if days < 7:
        return _WEEKDAYS[created.weekday()]
    return f"{created.month} 月 {created.day} 日"


def _clock(seconds: float) -> str:
    total = max(0, int(seconds))
    return f"{total // 60}:{total % 60:02d}"


__all__ = ["IdeasPlugin"]

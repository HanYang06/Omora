"""ideas：灵感页。

捕捉：录音或打字；账本：列表；搜索：打字给建议、回车看结果、点开看详情。
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
    Result,
    Row,
    Search,
    Suggestion,
    Text,
)

_WEEKDAYS = ("周一", "周二", "周三", "周四", "周五", "周六", "周日")
_FIELDS = {"title": "text", "archived": "bool", "pinned": "bool", "media": "text?"}
_SUGGESTIONS = 5
_RESULTS = 20
_SNIPPET = 40
HOME = "home"
RESULTS = "results"
DETAIL = "detail"


class IdeasPlugin:
    name = "ideas"

    def apply(self, ctx: Context) -> None:
        store: Any = ctx.resolve("store")
        media: Any = ctx.resolve("media")
        ui: Any = ctx.resolve("ui")
        ideas = store.collection(
            "ideas",
            fields=_FIELDS,
            indexes=["archived"],
            searchable=["title"],
            pinned="pinned",
        )
        state: dict[str, Any] = {"mode": HOME, "query": "", "open": None}
        history: list[tuple[str, str | None]] = []
        found: list[Any] = []

        def go(mode: str, record_id: str | None = None) -> None:
            if (mode, record_id) == (state["mode"], state["open"]):
                return
            opened = state["open"]
            history.append((str(state["mode"]), None if opened is None else str(opened)))
            state["mode"] = mode
            state["open"] = record_id

        def back(_: dict[str, Any]) -> None:
            if history:
                mode, record_id = history.pop()
                state["mode"] = mode
                state["open"] = record_id

        def search(value: str) -> list[Any]:
            text = value.strip()
            if not text:
                return []
            return list(ideas.search(text, limit=_RESULTS, where={"archived": False}))

        def query(payload: dict[str, Any]) -> None:
            value = str(payload.get("value", ""))
            state["query"] = value
            found[:] = search(value)

        def submit(payload: dict[str, Any]) -> None:
            value = str(payload.get("value", "")).strip()
            state["query"] = value
            found[:] = search(value)
            go(RESULTS if value else HOME)

        def capture_text(payload: dict[str, Any]) -> None:
            value = str(payload.get("value", "")).strip()
            if value:
                ideas.add(title=value, archived=False, pinned=False, media=None)

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
                pinned=False,
                media=media_id,
            )

        def opener(record_id: str) -> Handler:
            def run(payload: dict[str, Any]) -> None:
                go(DETAIL, record_id)

            return run

        def pinner(record_id: str, pinned: bool) -> Handler:
            def run(payload: dict[str, Any]) -> None:
                ideas.update(record_id, pinned=not pinned)

            return run

        def search_bar(offer: bool) -> Search:
            text = str(state["query"]).strip()
            items: list[Node] = []
            if offer and text:
                items = [
                    Suggestion(
                        value=item.title,
                        title=item.title,
                        meta=_when(item.created_at),
                        highlight=text,
                        on_pick=submit,
                    )
                    for item in found[:_SUGGESTIONS]
                ]
            return Search(
                *items,
                placeholder="搜索灵感…",
                value=str(state["query"]),
                on_query=query,
                on_submit=submit,
            )

        def home() -> Page:
            items = ideas.find({"archived": False}, order="created_at", limit=200)
            body: Node = (
                List(*[_item(record, ideas, pinner) for record in items])
                if items
                else Empty("还没有灵感。", "录一段，或者写第一条，按回车保存。")
            )
            return Page(
                content=Column(
                    search_bar(True),
                    Recorder(on_submit=capture_audio),
                    Input(placeholder="记一条灵感…", on_submit=capture_text),
                    body,
                ),
                meta=f"{len(items)} 条",
            )

        def results() -> Page:
            text = str(state["query"]).strip()
            if found:
                content: Node = List(
                    *[_result(record, text, opener(record.id)) for record in found]
                )
                meta = f"{len(found)} 条结果"
            else:
                content = Empty("没有匹配的灵感。", "换个词试试；只搜标题。")
                meta = "没有结果"
            return Page(content=Column(search_bar(False), _back_bar(back), content), meta=meta)

        def detail() -> Page | None:
            opened = state["open"]
            record = None if opened is None else ideas.get(str(opened))
            if record is None:
                state["mode"], state["open"] = HOME, None
                return None
            parts: list[Node] = [
                Row(
                    Button("← 返回", variant="ghost", on_click=back),
                    Text(_when(record.created_at), kind="muted"),
                ),
                Text(record.title, kind="title"),
            ]
            if record.media:
                parts.append(Audio(media=str(record.media)))
            return Page(content=Column(*parts), meta="置顶" if record.pinned else "")

        def build() -> Page:
            if state["mode"] == DETAIL:
                opened = detail()
                if opened is not None:
                    return opened
            if state["mode"] == RESULTS:
                return results()
            return home()

        ui.page(ctx, "ideas", "灵感", build, count=lambda: ideas.count({"archived": False}))


def _back_bar(handler: Handler) -> Node:
    return Row(Button("← 返回", variant="ghost", on_click=handler))


def _item(record: Any, ideas: Any, pinner: Any) -> Item:
    actions: list[Node] = []
    if record.media:
        actions.append(Audio(media=str(record.media)))
    label = "取消置顶" if record.pinned else "置顶"
    actions.append(
        Button(label, variant="ghost", on_click=pinner(record.id, bool(record.pinned)))
    )
    actions.append(Button("归档", variant="ghost", on_click=_archiver(ideas, record.id)))
    return Item(_when(record.created_at), record.title, *actions)


def _result(record: Any, query: str, handler: Handler) -> Result:
    return Result(
        title=record.title,
        snippet=_snippet(record.title, query),
        meta=_meta(record),
        highlight=query,
        on_click=handler,
    )


def _meta(record: Any) -> str:
    parts = [_when(record.created_at)]
    if record.pinned:
        parts.insert(0, "置顶")
    if record.media:
        parts.append("语音")
    return " · ".join(parts)


def _archiver(ideas: Any, record_id: str) -> Handler:
    def run(payload: dict[str, Any]) -> None:
        ideas.update(record_id, archived=True)

    return run


def _snippet(text: str, query: str, width: int = _SNIPPET) -> str:
    """命中词附近的一段；标题本来就短就原样给。"""
    needle = query.strip()
    if not needle or len(text) <= width:
        return text
    at = text.lower().find(needle.lower())
    if at < 0:
        return text[:width] + "…"
    start = min(max(0, at - (width - len(needle)) // 2), len(text) - width)
    piece = text[start : start + width]
    if start > 0:
        piece = "…" + piece
    if start + width < len(text):
        piece += "…"
    return piece


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

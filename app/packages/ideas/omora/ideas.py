"""ideas：灵感页。

三栏由页面自己排：Split(索引栏, 主区)。索引栏只导航；主区在同一页里换模式——
首页（搜索区、捕捉区、列表面板）、结果、详情、三种捕捉。
捕捉：文字是自己的；录音 / 录像由 audio / video 插件按服务名提供——它们没有，
对应的 Tile 就不出现。置顶 / 归档只在详情里做。

不 import 别的插件；store / media / ui 必须有，audio / video 有就用。
"""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from omora.sdk import Context
from omora.sdk.ui import (
    Button,
    Chip,
    Column,
    Empty,
    Handler,
    Input,
    List,
    Node,
    Page,
    Panel,
    Rail,
    Row,
    Search,
    Split,
    Suggestion,
    Text,
    Tile,
)

from . import _views
from ._format import now, spoken_title, video_title, when

_FIELDS = {"title": "text", "archived": "bool", "pinned": "bool", "media": "text?"}
_SUGGESTIONS = 5
_RESULTS = 20
_LIMIT = 200
_STALE_DAYS = 30
HOME = "home"
RESULTS = "results"
DETAIL = "detail"
CAPTURE_TEXT = "capture_text"
CAPTURE_AUDIO = "capture_audio"
CAPTURE_VIDEO = "capture_video"
_CAPTURES = (CAPTURE_TEXT, CAPTURE_AUDIO, CAPTURE_VIDEO)
_CHIPS = (
    ("all", "全部"),
    ("pinned", "置顶"),
    ("recent", "最近"),
    ("stale", "久未打开"),
)
_EMPTY = {
    "all": ("还没有灵感。", "记下的第一条会出现在这里。"),
    "pinned": ("还没有置顶的灵感。", "置顶的会钉在最前面。"),
    "recent": (f"最近 {_STALE_DAYS} 天没有新灵感。", "更早的灵感在「全部」里。"),
    "stale": (f"没有超过 {_STALE_DAYS} 天的灵感。", "放旧的灵感会落到这里。"),
}


class IdeasPlugin:
    name = "ideas"

    def apply(self, ctx: Context) -> None:
        store: Any = ctx.resolve("store")
        media: Any = ctx.resolve("media")
        ui: Any = ctx.resolve("ui")

        # audio / video 是可选能力，而且可能比 ideas 装得晚：manager 收到客户端
        # 能力上报之后才把它们装上，所以每次现取，不在 apply 里定死。
        def audio_service() -> Any:
            return ctx.resolve("audio") if ctx.has("audio") else None

        def video_service() -> Any:
            return ctx.resolve("video") if ctx.has("video") else None

        ideas = store.collection(
            "ideas",
            fields=_FIELDS,
            indexes=["archived"],
            searchable=["title"],
            pinned="pinned",
        )
        state: dict[str, Any] = {"mode": HOME, "query": "", "open": None, "filter": "all"}
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

        def enter(mode: str) -> Handler:
            def run(_: dict[str, Any]) -> None:
                go(mode)

            return run

        def choose(key: str) -> Handler:
            def run(_: dict[str, Any]) -> None:
                state["filter"] = key

            return run

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

        def save_text(payload: dict[str, Any]) -> None:
            value = str(payload.get("value", "")).strip()
            if not value:
                return
            ideas.add(title=value, archived=False, pinned=False, media=None)
            go(HOME)

        def save_audio(payload: dict[str, Any]) -> None:
            service = audio_service()
            if service is None:
                return
            media_id = service.capture(payload)
            if not media_id:
                return
            ideas.add(title=spoken_title(payload), archived=False, pinned=False, media=media_id)
            go(HOME)

        def save_video(payload: dict[str, Any]) -> None:
            service = video_service()
            if service is None:
                return
            media_id = service.capture(payload)
            if not media_id:
                return
            ideas.add(title=video_title(payload), archived=False, pinned=False, media=media_id)
            go(HOME)

        def opener(record_id: str) -> Handler:
            def run(_: dict[str, Any]) -> None:
                go(DETAIL, record_id)

            return run

        def pin(record_id: str, pinned: bool) -> Handler:
            def run(_: dict[str, Any]) -> None:
                ideas.update(record_id, pinned=not pinned)

            return run

        def archive(record_id: str) -> Handler:
            def run(_: dict[str, Any]) -> None:
                ideas.update(record_id, archived=True)
                go(HOME)

            return run

        def records() -> list[Any]:
            items = ideas.find({"archived": False}, order="created_at desc", limit=_LIMIT)
            # 稳定排序：置顶的整组提到前面，组内仍是创建时间倒序。
            return sorted(items, key=lambda record: not record.pinned)

        def filtered(items: list[Any]) -> list[Any]:
            key = str(state["filter"])
            if key == "all":
                return items
            cutoff = now() - timedelta(days=_STALE_DAYS)
            if key == "pinned":
                return [item for item in items if item.pinned]
            if key == "recent":
                return [item for item in items if item.created_at >= cutoff]
            return [item for item in items if item.created_at < cutoff]

        def search_bar(offer: bool) -> Search:
            text = str(state["query"]).strip()
            items: list[Node] = []
            if offer and text:
                items = [
                    Suggestion(
                        value=item.title,
                        title=item.title,
                        meta=when(item.created_at),
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

        def rail() -> Rail:
            return Rail(
                "全部灵感",
                *[_views.rail_item(record, opener(record.id)) for record in records()],
            )

        def tiles() -> list[Node]:
            nodes: list[Node] = []
            if audio_service() is not None:
                nodes.append(Tile(icon="mic", title="录音", on_click=enter(CAPTURE_AUDIO)))
            video = video_service()
            if video is not None and video.node(save_video) is not None:
                nodes.append(Tile(icon="video", title="视频", on_click=enter(CAPTURE_VIDEO)))
            nodes.append(Tile(icon="text", title="文字", on_click=enter(CAPTURE_TEXT)))
            return nodes

        def feed(items: list[Any]) -> Node:
            if not items:
                title, hint = _EMPTY[str(state["filter"])]
                return Empty(title, hint)
            return Column(*[_views.card(record, media, opener(record.id)) for record in items])

        def home() -> Page:
            items = records()
            chips = [
                Chip(text=label, active=str(state["filter"]) == key, on_click=choose(key))
                for key, label in _CHIPS
            ]
            return Page(
                content=Column(
                    search_bar(True),
                    Row(*tiles()),
                    Panel(Row(*chips), feed(filtered(items))),
                ),
                meta=f"{len(items)} 条",
            )

        def results() -> Page:
            text = str(state["query"]).strip()
            if found:
                content: Node = List(
                    *[_views.result(record, text, media, opener(record.id)) for record in found]
                )
                meta = f"{len(found)} 条结果"
            else:
                content = Empty("没有匹配的灵感。", "换个词试试。")
                meta = "没有结果"
            return Page(content=Column(search_bar(False), _views.back_bar(back), content), meta=meta)

        def detail() -> Page | None:
            opened = state["open"]
            record = None if opened is None else ideas.get(str(opened))
            if record is None:
                state["mode"], state["open"] = HOME, None
                return None
            parts: list[Node] = [
                Row(
                    Button("← 返回", variant="ghost", on_click=back),
                    Text(when(record.created_at, now()), kind="muted"),
                ),
                Text(record.title, kind="title"),
            ]
            player = _views.player(record, media, video_service())
            if player is not None:
                parts.append(player)
            parts.append(
                Row(
                    Button(
                        "取消置顶" if record.pinned else "置顶",
                        variant="ghost",
                        on_click=pin(record.id, bool(record.pinned)),
                    ),
                    Button("归档", variant="ghost", on_click=archive(record.id)),
                )
            )
            return Page(content=Column(*parts), meta="置顶" if record.pinned else "")

        def capture(mode: str) -> Page:
            body: list[Node] = []
            if mode == CAPTURE_TEXT:
                body.append(Input(placeholder="记一条灵感…", on_submit=save_text))
            else:
                audio = mode == CAPTURE_AUDIO
                service = audio_service() if audio else video_service()
                node = None if service is None else service.node(save_audio if audio else save_video)
                if node is not None:
                    body.append(node)
            if not body:
                body.append(Empty("这条捕捉暂时用不了。", "回首页再试。"))
            return Page(content=Column(_views.back_bar(back), *body))

        def page() -> Page:
            mode = str(state["mode"])
            if mode == DETAIL:
                opened = detail()
                if opened is not None:
                    return opened
            if mode == RESULTS:
                return results()
            if mode in _CAPTURES:
                return capture(mode)
            return home()

        def build() -> Page:
            current = page()
            return Page(content=Split(rail(), current.content), meta=current.meta)

        ui.page(
            ctx,
            "ideas",
            "灵感",
            build,
            count=lambda: ideas.count({"archived": False}),
            icon="ideas",
        )


__all__ = ["IdeasPlugin"]

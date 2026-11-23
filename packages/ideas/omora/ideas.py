"""ideas：灵感页。

三栏由页面自己排：Split(索引栏, 主区)。索引栏只导航；主区在同一页里换模式——
首页（搜索区、捕捉区、列表面板）、结果、详情。捕捉就地做：点 Tile 只把捕捉区换成
工作区，不换页；停止录制就是落库，收起回三个 Tile。捕捉区自己的状态在 _capture。
录音 / 录像由 audio / video 插件按服务名提供——它们没有，对应的 Tile 就不出现。
置顶 / 归档只在详情里做。

不 import 别的插件；store / media / ui 必须有，audio / video 有就用。
"""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from omora.sdk import Context
from omora.sdk.ui import (
    Button,
    Chip,
    Collection,
    Column,
    Empty,
    Handler,
    Hotkey,
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
)

from . import _capture, _views
from ._format import now, when

_FIELDS = {"title": "text", "archived": "bool", "pinned": "bool", "media": "text?"}
_SUGGESTIONS = 5
_RESULTS = 20
_LIMIT = 200
_STALE_DAYS = 30
HOME = "home"
RESULTS = "results"
DETAIL = "detail"
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

    def apply(self, ctx: Context) -> None:  # noqa: PLR0915 —— 插件装配的线性编排
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
        state: dict[str, Any] = {
            "mode": HOME,
            "query": "",
            "open": None,
            "filter": "all",
            # 列表是数据，不是页面节点：这一页的节点数与条目数无关。
            "items": [],
            "feed": [],
        }
        handle: Any = None

        def item(record: Any) -> dict[str, Any]:
            """一条灵感 → 集合条目；模板用 bound() 把它投影成标题 / 时间。"""
            return {
                "id": str(record.id),
                "template": "item",
                "title": record.title,
                "meta": _views.meta(record, media),
            }

        def push_items() -> None:
            """列表变了才推数据：结构不动，客户端按 key 只改动的那些条目。"""
            if handle is None:
                return
            handle.data("ideas.rail", items=[item(record) for record in state["items"]])
            handle.data("ideas.feed", items=[item(record) for record in state["feed"]])

        def refresh() -> None:
            """结构变了（模式 / 查询 / 空态）：只重交页面树的形状。"""
            if handle is not None:
                handle.set(build())

        def refresh_items() -> None:
            """store 变了：重新取条目、推数据；页面形状只跟着空态 / 计数走。"""
            state["items"] = records()
            state["feed"] = filtered(state["items"])
            push_items()
            refresh()

        def refilter() -> None:
            """筛选只看内存里的条目，不必回 store 再取一遍。"""
            state["feed"] = filtered(state["items"])
            push_items()
            refresh()

        capture = _capture.Capture(
            ideas, media, audio_service, video_service, changed=refresh_items
        )
        history: list[tuple[str, str | None]] = []
        found: list[Any] = []

        def go(mode: str, record_id: str | None = None) -> None:
            if (mode, record_id) == (state["mode"], state["open"]):
                return
            opened = state["open"]
            history.append((str(state["mode"]), None if opened is None else str(opened)))
            state["mode"] = mode
            state["open"] = record_id
            if mode != HOME:
                # 换页就没了：捕捉区不是持久状态。
                capture.clear()

        def back(_: dict[str, Any]) -> None:
            if history:
                mode, record_id = history.pop()
                state["mode"] = mode
                state["open"] = record_id
            refresh()

        def choose(key: str) -> Handler:
            def run(_: dict[str, Any]) -> None:
                state["filter"] = key
                refilter()

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
            refresh()

        def submit(payload: dict[str, Any]) -> None:
            value = str(payload.get("value", "")).strip()
            state["query"] = value
            found[:] = search(value)
            go(RESULTS if value else HOME)
            refresh()

        def opener(record_id: str) -> Handler:
            def run(_: dict[str, Any]) -> None:
                go(DETAIL, record_id)
                refresh()

            return run

        def open_item(payload: dict[str, Any]) -> None:
            """集合条目共用一个 handler：运行时把条目 key 放进 payload.item。"""
            record_id = str(payload.get("item", ""))
            if record_id:
                go(DETAIL, record_id)
                refresh()

        def pin(record_id: str, pinned: bool) -> Handler:
            def run(_: dict[str, Any]) -> None:
                ideas.update(record_id, pinned=not pinned)
                refresh_items()

            return run

        def archive(record_id: str) -> Handler:
            def run(_: dict[str, Any]) -> None:
                ideas.update(record_id, archived=True)
                go(HOME)
                refresh_items()

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
            # 索引栏也是一个集合槽：条目再多，这一页的节点数不变。
            return Rail(
                "全部灵感",
                Collection("ideas.rail", "id", {"item": _views.rail_template(open_item)}),
            )

        def feed() -> Node:
            if not state["feed"]:
                title, hint = _EMPTY[str(state["filter"])]
                return Empty(title, hint)
            return Collection("ideas.feed", "id", {"item": _views.card_template(open_item)})

        def home() -> Page:
            items = state["items"]
            chips = [
                Chip(text=label, active=str(state["filter"]) == key, on_click=choose(key))
                for key, label in _CHIPS
            ]
            return Page(
                content=Column(
                    search_bar(True),
                    capture.region(),
                    Panel(Row(*chips), feed()),
                    # 常驻在捕捉区外面：工作区换形态时它不能被卸载，否则收不到松手。
                    Hotkey(key="space", on_press=capture.hold_start, on_release=capture.hold_end),
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
            return Page(
                content=Column(search_bar(False), _views.back_bar(back), content), meta=meta
            )

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

        def page() -> Page:
            mode = str(state["mode"])
            if mode == DETAIL:
                opened = detail()
                if opened is not None:
                    return opened
            if mode == RESULTS:
                return results()
            return home()

        def build() -> Page:
            current = page()
            return Page(content=Split(rail(), current.content), meta=current.meta)

        handle = ui.page(
            ctx,
            "ideas",
            "灵感",
            count=lambda: ideas.count({"archived": False}),
            icon="ideas",
        )
        handle.rebuild(build)
        refresh_items()


__all__ = ["IdeasPlugin"]

"""主会话 Slot 视图：view 的构造、handler 代次与异步推送。

ui.py 只做接线：页面登记、set_page / refresh_page 走这里。这里管三件事：

1. 页面列表 + 当前页 → 一份 view：nav 局部树 + page 局部树 + 页面侧表 +
   active + data + 单调 version（权威根树仍由 TS 链接器链接）；
2. handler 代次登记：树里的事件写 id，上一代留一次宽限；
3. set_page / refresh_page 时推整份 view 到 ui.snapshot。

页面信息与页面树都经构造参数回调拿，不 import ui.py。
"""

from __future__ import annotations

import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Any

from omora.core.log import Log
from omora.sdk.document import Handler, PageEntry, Register
from omora.sdk.slot_tree import NavLink, page_id, serialize_nav_slot, serialize_page_slot
from omora.sdk.ui import Page
from omora.sdk.view import serialize_view

Emit = Callable[[dict[str, Any]], None]


@dataclass(frozen=True)
class PageInfo:
    """页面侧表与页面根共用的一份信息；owner 是注册者。"""

    name: str
    label: str
    owner: str
    icon: str | None


def build_view(  # noqa: PLR0913 —— view 信封的声明式参数
    *,
    active: PageInfo,
    body: Page,
    register: Register,
    links: Sequence[NavLink],
    pages: Sequence[PageInfo],
    version: int,
) -> dict[str, Any]:
    """nav + page 两棵局部树 + 页面侧表 → view payload。"""
    nav = serialize_nav_slot(links, register)
    page = serialize_page_slot(
        body,
        register,
        owner=active.owner,
        page_name=active.name,
        label=active.label,
        icon=active.icon,
    )
    entries = [
        PageEntry(
            page_id(item.name),
            item.label,
            route=f"/{item.name}",
            owner=item.owner,
            icon=item.icon,
        )
        for item in pages
    ]
    return serialize_view(
        [nav, page],
        entries,
        page_id(active.name),
        {},
        register,
        version=version,
        seq=version,
    )


class SlotView:
    """Slot 视图的状态机：当前页、view 版本、handler 代次。"""

    def __init__(  # noqa: PLR0913 —— 接线回调
        self,
        *,
        names: Callable[[], Sequence[str]],
        info: Callable[[str], PageInfo],
        body: Callable[[str], Page],
        rebuild: Callable[[str], None],
        emit: Emit,
        log: Log,
    ) -> None:
        self._names = names
        self._info = info
        self._body = body
        self._rebuild = rebuild
        self._emit = emit
        self._log = log
        self._active: str | None = None
        self._version = 0
        self._generation = 0
        self._handlers: dict[str, Handler] = {}
        self._previous: dict[str, Handler] = {}

    # ---- 出口 ----------------------------------------------------------

    def render(self, page: str | None) -> dict[str, Any]:
        """全量兜底：当前页（或指定页）+ 导航 → 一份新 view。"""
        name = page if page is not None else self._active
        if name is None:
            names = list(self._names())
            name = names[0] if names else None
        if name is None:
            raise LookupError("没有登记任何页面")
        started = time.perf_counter()
        self._rebuild(name)
        self._active = name
        view = self._view(name)
        self._log.debug(
            "ui.render",
            page=name,
            ms=(time.perf_counter() - started) * 1000,
        )
        return view

    def event(self, handler: str, payload: dict[str, Any]) -> dict[str, Any]:
        """先派发（含上一代宽限），再把当前页的新 view 交回去。"""
        callback = self._handlers.get(handler)
        late = callback is None
        if callback is None:
            callback = self._previous.get(handler)
        if callback is None:
            self._log.warning("ui.event.unknown", handler=handler)
            raise LookupError(f"未知 handler: {handler}")
        if late:
            self._log.info("ui.event.stale", handler=handler, page=self._active)
        started = time.perf_counter()
        callback(payload)
        if self._active is None:
            names = list(self._names())
            if not names:
                raise LookupError("没有登记任何页面")
            self._active = names[0]
        view = self._view(self._active)
        self._log.info(
            "ui.event",
            handler=handler,
            page=self._active,
            ms=(time.perf_counter() - started) * 1000,
        )
        return view

    def push(self) -> None:
        """页面树换了 / 手动 refresh：客户端已经有一份视图就推一份新的整份 view。"""
        if self._active is None:
            return
        self._emit(self._view(self._active))

    def page_removed(self, name: str) -> None:
        """页面被卸载：它恰好是当前页时清掉，下一次 render 回到第一页。"""
        if self._active == name:
            self._active = None

    # ---- 构造 ----------------------------------------------------------

    def _view(self, name: str) -> dict[str, Any]:
        self._version += 1
        self._generation += 1
        self._previous = self._handlers
        self._handlers = {}
        register = self._register()
        pages = [self._info(item) for item in self._names()]
        links = [
            NavLink(
                item.name,
                item.label,
                item.icon,
                self._nav_handler(item.name),
                active=item.name == name,
            )
            for item in pages
        ]
        return build_view(
            active=self._info(name),
            body=self._body(name),
            register=register,
            links=links,
            pages=pages,
            version=self._version,
        )

    def _nav_handler(self, target: str) -> Handler:
        """导航条目点了把当前页切成它；重建后的 view 由 event 交回去。"""

        def navigate(_payload: dict[str, Any]) -> None:
            self._active = target

        return navigate

    def _register(self) -> Register:
        """handler id 代次登记：按对象身份记住第一次给的 id，serialize 时复用。"""
        assigned: dict[int, str] = {}
        index = 0
        generation = self._generation

        def register(callback: Handler) -> str:
            nonlocal index
            known = assigned.get(id(callback))
            if known is not None:
                return known
            handler = f"slot:{generation}:{index}"
            index += 1
            assigned[id(callback)] = handler
            self._handlers[handler] = callback
            return handler

        return register


__all__ = ["PageInfo", "SlotView", "build_view"]

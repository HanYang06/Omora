"""ui：页面登记、渲染、事件派发。

它不碰 socket，也不认识业务。插件把一页交给它，它把页变成一份快照：
导航条目（pages）、当前页（page）、标题旁的话（meta）、内容树（content）。
"""

from __future__ import annotations

import time
from collections.abc import Callable
from typing import Any

from omora.core.log import Log, NullLog
from omora.sdk import Context
from omora.sdk.ui import Handler, Page, serialize

Builder = Callable[[], Page]
Counter = Callable[[], int]


class _Page:
    def __init__(
        self, label: str, build: Builder, count: Counter | None, icon: str | None
    ) -> None:
        self.label = label
        self.build = build
        self.count = count
        self.icon = icon
        # serial 只增不减：handler id 永不复用，陈旧的 id 打不到别人的回调上。
        self.serial = 0
        self.handlers: dict[str, Handler] = {}
        self.previous: dict[str, Handler] = {}


class Ui:
    def __init__(self, log: Log | None = None) -> None:
        self._pages: dict[str, _Page] = {}
        self._log = log if log is not None else NullLog()

    def page(
        self,
        ctx: Context,
        name: str,
        label: str,
        build: Builder,
        count: Counter | None = None,
        icon: str | None = None,
    ) -> None:
        """登记一页；插件卸载时页面跟着消失。icon 是母页面图标栏用的名字。"""
        if name in self._pages:
            raise ValueError(f"页面重复登记: {name}")
        self._pages[name] = _Page(label, build, count, icon)

        def remove() -> None:
            self._pages.pop(name, None)

        ctx.effect(remove)

    def render(self, page: str | None = None) -> dict[str, Any]:
        """画一页；不指定就画第一个登记的。"""
        name = page if page is not None else next(iter(self._pages), None)
        if name is None:
            raise LookupError("没有登记任何页面")
        entry = self._entry(name)
        started = time.perf_counter()
        snapshot = self._draw(name, entry)
        self._log.debug("ui.render", page=name, ms=(time.perf_counter() - started) * 1000)
        return snapshot

    def event(self, handler: str, payload: dict[str, Any]) -> dict[str, Any]:
        """把载荷交给 handler，然后重画它所属的那一页。

        上一代的 handler 还留着一次宽限：组件卸载时提交的事件（例如录制中点
        「收起」，引擎在卸载时停止并提交）带的 id 属于上一代，不能静默丢掉。
        """
        for name, entry in self._pages.items():
            callback = entry.handlers.get(handler)
            late = callback is None
            if callback is None:
                callback = entry.previous.get(handler)
            if callback is not None:
                if late:
                    self._log.info("ui.event.stale", handler=handler, page=name)
                started = time.perf_counter()
                callback(payload)
                snapshot = self._draw(name, entry)
                self._log.info(
                    "ui.event", handler=handler, page=name, ms=(time.perf_counter() - started) * 1000
                )
                return snapshot
        self._log.warning("ui.event.unknown", handler=handler)
        raise LookupError(f"未知 handler: {handler}")

    def _entry(self, page: str) -> _Page:
        entry = self._pages.get(page)
        if entry is None:
            raise LookupError(f"未知页面: {page}")
        return entry

    def _draw(self, name: str, entry: _Page) -> dict[str, Any]:
        next_id = 0
        entry.serial += 1
        held = entry.serial
        entry.previous = entry.handlers
        entry.handlers = {}

        def register(callback: Handler) -> str:
            nonlocal next_id
            handler = f"{name}:{held}:{next_id}"
            next_id += 1
            entry.handlers[handler] = callback
            return handler

        page = entry.build()
        pages: list[dict[str, Any]] = []
        for key, item in self._pages.items():
            entry_data: dict[str, Any] = {"name": key, "label": item.label}
            if item.icon is not None:
                entry_data["icon"] = item.icon
            if item.count is not None:
                entry_data["count"] = item.count()
            pages.append(entry_data)

        return {
            "pages": pages,
            "page": name,
            "meta": page.meta,
            "content": serialize(page.content, register),
        }


class UiPlugin:
    name = "ui"

    def apply(self, ctx: Context) -> None:
        ctx.provide("ui", Ui(ctx.log))


__all__ = ["Ui", "UiPlugin"]

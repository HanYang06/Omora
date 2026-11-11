"""ui：页面登记、渲染、事件派发。

它不碰 socket，也不认识业务。插件把一页交给它，它把页变成一份快照：
导航条目（pages）、当前页（page）、标题旁的话（meta）、内容树（content）、版本（version）。

视图只有一个出口（协议 §6.1）：`render` 的 result 是全量快照，`event` 的 result 只有确认；
事件引起的视图变化走 `ui.snapshot`——能 diff 就带补丁，不能（换页 / 首次 / 算不出）就带全量。
"""

from __future__ import annotations

import time
from collections.abc import Callable
from typing import Any

from omora.core.log import Log, NullLog
from omora.sdk import Context
from omora.sdk.realtime import emit
from omora.sdk.ui import Handler, Page, serialize

from ._diff import diff_snapshot

Builder = Callable[[], Page]
Counter = Callable[[], int]

SNAPSHOT_TOPIC = "ui.snapshot"


class _Page:
    def __init__(self, label: str, build: Builder, count: Counter | None, icon: str | None) -> None:
        self.label = label
        self.build = build
        self.count = count
        self.icon = icon
        # serial 只增不减：handler id 永不复用，陈旧的 id 打不到别人的回调上。
        self.serial = 0
        self.handlers: dict[str, Handler] = {}
        self.previous: dict[str, Handler] = {}
        # version 是这一页自己的单调计数；每次交给客户端一份快照就加一。
        self.version = 0
        # sent 是上一次交给客户端的那份（补丁的基准）。
        self.sent: dict[str, Any] | None = None


class Ui:
    def __init__(self, log: Log | None = None, ctx: Context | None = None) -> None:
        self._pages: dict[str, _Page] = {}
        self._log = log if log is not None else NullLog()
        self._ctx = ctx
        # 客户端手里那一份：换页时无法 diff，只能推全量。
        self._current: dict[str, Any] | None = None

    def page(  # noqa: PLR0913, PLR0917 —— 页面登记的声明式参数
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
        """画一页；不指定就画第一个登记的。result 是全量快照（带 version）。"""
        name = page if page is not None else next(iter(self._pages), None)
        if name is None:
            raise LookupError("没有登记任何页面")
        entry = self._entry(name)
        started = time.perf_counter()
        snapshot = self._deliver(entry, self._draw(name, entry))
        self._log.debug("ui.render", page=name, ms=(time.perf_counter() - started) * 1000)
        return snapshot

    def event(self, handler: str, payload: dict[str, Any]) -> dict[str, Any]:
        """把载荷交给 handler，重画它所属的那一页；result 只有确认（{}）。

        视图不搭 result 的车：变化走 `ui.snapshot`（协议 §6.1）。

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
                body = self._draw(name, entry)
                pushed = self._push(name, entry, body)
                self._log.info(
                    "ui.event",
                    handler=handler,
                    page=name,
                    ms=(time.perf_counter() - started) * 1000,
                    push=pushed,
                )
                return {}
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

    def _deliver(self, entry: _Page, body: dict[str, Any]) -> dict[str, Any]:
        """交给客户端一份新的全量快照：升版本，记成下一次补丁的基准。"""
        entry.version += 1
        snapshot = {**body, "version": entry.version}
        entry.sent = snapshot
        self._current = snapshot
        return snapshot

    def _push(self, name: str, entry: _Page, body: dict[str, Any]) -> str:
        """事件引起的视图变化：能 diff 就推补丁，否则推全量。返回推的是哪种，供日志看。"""
        base = entry.sent
        current = self._current
        if current is None or current.get("page") != name or base is None:
            # 客户端手里不是这一页（或还没拿过）：补丁无从谈起，推全量。
            self._emit(self._deliver(entry, body))
            return "full"
        patch = diff_snapshot(base, body)
        if patch is None:
            self._emit(self._deliver(entry, body))
            return "full"

        ops, merged = patch
        if not ops:
            # 视图没变：不推，也不动版本，客户端手里的那份仍然是最新的。
            return "none"

        entry.version += 1
        merged["version"] = entry.version
        entry.sent = merged
        self._current = merged
        self._emit({"page": name, "version": entry.version, "base": base["version"], "ops": ops})
        return "patch"

    def _emit(self, payload: dict[str, Any]) -> None:
        if self._ctx is None:
            return
        emit(self._ctx, SNAPSHOT_TOPIC, payload)


class UiPlugin:
    name = "ui"

    def apply(self, ctx: Context) -> None:
        ctx.provide("ui", Ui(ctx.log, ctx))


__all__ = ["SNAPSHOT_TOPIC", "Ui", "UiPlugin"]

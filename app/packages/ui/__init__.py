"""ui：视图登记、渲染、事件派发。

它不碰 socket，也不认识业务。插件把一棵节点树交给它，它把树变成纯数据。
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from core.context import Context
from sdk.ui import Handler, Node, serialize

Builder = Callable[[], Node]


class _View:
    def __init__(self, build: Builder) -> None:
        self.build = build
        self.generation = 0
        self.handlers: dict[str, Handler] = {}


class Ui:
    def __init__(self) -> None:
        self._views: dict[str, _View] = {}

    def view(self, ctx: Context, name: str, build: Builder) -> None:
        """登记一个视图；插件卸载时自动消失。"""
        if name in self._views:
            raise ValueError(f"视图重复登记: {name}")
        self._views[name] = _View(build)

        def remove() -> None:
            self._views.pop(name, None)

        ctx.effect(remove)

    def render(self, view: str) -> list[dict[str, Any]]:
        """重建这个视图：开新一代，上一代的 handler 全部作废。"""
        entry = self._entry(view)
        entry.generation += 1
        entry.handlers.clear()
        return self._draw(view, entry)

    def event(self, handler: str, payload: dict[str, Any]) -> list[dict[str, Any]]:
        """跑 handler，然后重画它所属的那个视图。"""
        del payload
        for name, entry in self._views.items():
            callback = entry.handlers.get(handler)
            if callback is not None:
                callback()
                return self._draw(name, entry)
        raise LookupError(f"未知 handler: {handler}")

    def _entry(self, view: str) -> _View:
        entry = self._views.get(view)
        if entry is None:
            raise LookupError(f"未知视图: {view}")
        return entry

    def _draw(self, view: str, entry: _View) -> list[dict[str, Any]]:
        next_id = 0

        def register(callback: Handler) -> str:
            nonlocal next_id
            handler = f"{view}:{entry.generation}:{next_id}"
            next_id += 1
            entry.handlers[handler] = callback
            return handler

        return [serialize(entry.build(), register)]


class UiPlugin:
    name = "ui"

    def apply(self, ctx: Context) -> None:
        ctx.provide("ui", Ui())


__all__ = ["Ui", "UiPlugin"]

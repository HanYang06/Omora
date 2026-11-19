"""ui：页面登记、渲染与事件派发。

它不碰 socket，也不认识业务。插件把一页交给它，它把页变成主会话视图（wire §8）：
nav / page 两棵局部树 + 页面侧表 + active + data + 单调 version；权威根树由 TS 链接器链接。

视图只有一个出口：render 的 result 是整份 view，event 的 result 是新 view；
异步变化（set_page / refresh_page）走 ui.snapshot 推整份 view。
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from omora.core.log import Log, NullLog
from omora.sdk import Context
from omora.sdk.realtime import emit
from omora.sdk.tree_build import NavEntry, build_page
from omora.sdk.ui import Page

from ._handle import PageHandle
from ._slot import PageInfo, SlotView

Builder = Callable[[], Page]
Counter = Callable[[], int]

SNAPSHOT_TOPIC = "ui.snapshot"


class _Page:
    def __init__(  # noqa: PLR0913, PLR0917 —— 页面登记字段
        self,
        owner: str,
        label: str,
        build: Builder | None,
        count: Counter | None,
        icon: str | None,
        glyph: str | None = None,
    ) -> None:
        # owner 是登记这一页的插件名（ctx.name）。
        self.owner = owner
        self.label = label
        self.glyph = glyph
        # 三种：build 回调（拉取式）、插件 set 上来的树（推送式）、
        # rebuild 钩子（只在客户端明确要一页时重建，用来吸收插件装卸这类外部变化）。
        self.build = build
        self.tree: Page | None = None
        self.rebuild: Builder | None = None
        self.count = count
        self.icon = icon


class Ui:
    def __init__(self, log: Log | None = None, ctx: Context | None = None) -> None:
        self._pages: dict[str, _Page] = {}
        self._log = log if log is not None else NullLog()
        self._ctx = ctx
        # 事件回调运行期间由 ui 负责交新 view，set_page 不要再另推一份。
        self._in_event = False
        self._tree_handlers: dict[str, Callable[[dict[str, Any]], None]] = {}
        self._tree_generation = 0
        self._slots = SlotView(
            names=lambda: list(self._pages),
            info=self._page_info,
            body=lambda name: self._page_body(name, self._entry(name)),
            rebuild=self._rebuild,
            emit=self._emit,
            log=self._log,
        )

    def page(  # noqa: PLR0913, PLR0917 —— 页面登记的声明式参数
        self,
        ctx: Context,
        name: str,
        label: str,
        build: Builder | None = None,
        count: Counter | None = None,
        icon: str | None = None,
        glyph: str | None = None,
    ) -> PageHandle:
        """登记一页；插件卸载时页面跟着消失。icon 是母页面图标栏用的名字。

        返回页面对象：想自己交树就用 `handle.set(Page(...))`；给了 build 回调的就还是拉取式。
        """
        if name in self._pages:
            raise ValueError(f"页面重复登记: {name}")
        self._pages[name] = _Page(ctx.name, label, build, count, icon, glyph)

        def remove() -> None:
            self._pages.pop(name, None)
            self._slots.page_removed(name)

        ctx.effect(remove)
        return PageHandle(self, name)

    def set_page(self, name: str, page: Page) -> None:
        """插件交来一页当前的树；客户端已经有一份视图就推一份新的整份 view。"""
        self._entry(name).tree = page
        if self._in_event:
            return
        self._slots.push()

    def bind_rebuild(self, name: str, builder: Builder) -> None:
        self._entry(name).rebuild = builder

    def refresh_page(self, name: str) -> None:
        """把当前页的视图重交给客户端一次（全量兜底）。"""
        self._entry(name)
        self._slots.push()

    def render(self, page: str | None = None) -> dict[str, Any]:
        """画一页；不指定就画当前页（还没有就画第一个登记的）。result 是整份 view。"""
        return self._slots.render(page)

    def page_tree(self, name: str) -> Page:
        """这一页当前的节点树（拉取式 build 或插件交上来的树）；构建期工具用。"""
        return self._page_body(name, self._entry(name))

    def tree(self, page: str | None = None) -> dict[str, Any]:
        """当前页的 V1 树构建输入（base + 局部树）；V1 主路径的迁移桥，构建期同款。

        只搬形状：事件 callable 经 register 换成 handler id；TS 侧 compose 后挂载。
        """
        view = self._slots.render(page)
        active = str(view["active"])
        pages = [item for item in view["pages"] if isinstance(item, dict)]
        current = next((item for item in pages if item.get("id") == active), None)
        if current is None:
            raise LookupError(f"当前页不在侧表里: {active}")
        name = active.removeprefix("page.")
        self._tree_generation += 1
        generation = self._tree_generation
        handlers: dict[str, Callable[[dict[str, Any]], None]] = {}
        counter = 0

        def register(callback: Callable[[dict[str, Any]], None]) -> str:
            nonlocal counter
            counter += 1
            handler = f"tree:{generation}:{counter}"
            handlers[handler] = callback
            return handler

        def nav_entry(item: dict[str, Any]) -> NavEntry:
            target = str(item["id"]).removeprefix("page.")

            def navigate(_payload: dict[str, Any], target: str = target) -> None:
                self._slots.activate(target)

            return NavEntry(
                name=target,
                title=str(item["label"]),
                icon=None if item.get("icon") is None else str(item["icon"]),
                on_click=navigate,
            )

        nav = [nav_entry(item) for item in pages]
        built = build_page(
            name=name,
            title=str(current["label"]),
            route=str(current.get("route") or f"/{name}"),
            page=self.page_tree(name),
            owner=str(current["owner"]),
            nav=nav,
            register=register,
        )
        self._tree_handlers = handlers
        return {"kind": "tree", **built}

    def tree_event(self, handler: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        """tree 的 handler 派发：执行后交一份新 tree（handler id 换代）。"""
        callback = self._tree_handlers.get(handler)
        if callback is None:
            raise LookupError(f"未知 handler: {handler}")
        self._in_event = True
        try:
            callback({} if payload is None else payload)
        finally:
            self._in_event = False
        return self.tree()

    def event(self, handler: str, payload: dict[str, Any]) -> dict[str, Any]:
        """把载荷交给 handler；result 是派发之后当前页的新 view。"""
        self._in_event = True
        try:
            return self._slots.event(handler, payload)
        finally:
            self._in_event = False

    def _entry(self, page: str) -> _Page:
        entry = self._pages.get(page)
        if entry is None:
            raise LookupError(f"未知页面: {page}")
        return entry

    def _page_info(self, name: str) -> PageInfo:
        entry = self._entry(name)
        return PageInfo(name, entry.label, entry.owner, entry.icon)

    def _rebuild(self, name: str) -> None:
        entry = self._entry(name)
        if entry.rebuild is not None:
            entry.tree = entry.rebuild()

    def _page_body(self, name: str, entry: _Page) -> Page:
        """这一页现在长什么样：build 回调（拉取）或插件交上来的树（推送）。"""
        if entry.build is not None:
            return entry.build()
        if entry.tree is not None:
            return entry.tree
        raise LookupError(f"页面还没交树: {name}")

    def _emit(self, payload: dict[str, Any]) -> None:
        if self._ctx is None:
            return
        emit(self._ctx, SNAPSHOT_TOPIC, payload)


class UiPlugin:
    name = "ui"

    def apply(self, ctx: Context) -> None:
        ctx.provide("ui", Ui(ctx.log, ctx))


__all__ = ["SNAPSHOT_TOPIC", "PageHandle", "Ui", "UiPlugin"]

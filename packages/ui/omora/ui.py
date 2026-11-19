"""ui：页面登记、V1 树构建与事件派发。

它不碰 socket，也不认识业务。插件把一页交给它，Ui 自己记页面列表与 active，
按页产出 `dendro.tree/1` 的 base + 局部树（导航 + 内容）；事件经稳定 handler id
派发，回包是“上一棵树 → 新树”的差分 ops。client 首帧 / 整页兜底走 `tree()`。

异步变化（set_page / refresh_page）在 active 页上推一帧 `ui.changed`：能差分就
推 ops，表达不了就推整树。`tree()` 仍是首帧 / 重连的全量入口。
"""

from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from omora.core.log import Log, NullLog
from omora.sdk import Context
from omora.sdk.realtime import emit
from omora.sdk.tree_build import NavEntry, build_page, compose
from omora.sdk.tree_diff import diff_documents, needs_full
from omora.sdk.ui import Page

from ._handle import PageHandle

Builder = Callable[[], Page]
Counter = Callable[[], int]

CHANGED_TOPIC = "ui.changed"


@dataclass(frozen=True)
class PageInfo:
    """页面登记信息；owner 是登记这一页的插件名。"""

    name: str
    label: str
    owner: str
    icon: str | None


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
        self._in_event = False
        self._pushing = False
        # 页面列表与 active 由 Ui 自己管：tree() 按它选页，导航回调改它。
        self._active: str | None = None
        self._tree_handlers: dict[str, Callable[[dict[str, Any]], None]] = {}
        # 上一代 handler 留一次宽限：组件卸载时提交带的 id 属于上一代，不能丢。
        self._previous_handlers: dict[str, Callable[[dict[str, Any]], None]] = {}
        self._tree_document: dict[str, Any] | None = None
        self._tree_version = 0
        self._tree_seq = 0

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
            if self._active == name:
                self._active = None
                self._push()

        ctx.effect(remove)
        return PageHandle(self, name)

    def set_page(self, name: str, page: Page) -> None:
        """插件交来一页当前的树；active 页立即推一帧 `ui.changed`。"""
        self._entry(name).tree = page
        if self._active is None or name == self._active:
            self._push()

    def refresh_page(self, name: str) -> None:
        """让 active 页按最新状态重建，并推一帧 `ui.changed`。"""
        self._entry(name)
        if self._active is None or name == self._active:
            self._push()

    def bind_rebuild(self, name: str, builder: Builder) -> None:
        self._entry(name).rebuild = builder

    def pages(self) -> tuple[PageInfo, ...]:
        """按登记顺序列出页面（构建期工具与调试用；不进 wire）。"""
        return tuple(
            PageInfo(name, entry.label, entry.owner, entry.icon)
            for name, entry in self._pages.items()
        )

    @property
    def active_page(self) -> str | None:
        """当前活动页的登记名；还没有选中时 None。"""
        return self._active

    @property
    def current_document(self) -> dict[str, Any] | None:
        """最近一次 tree() / tree_event 组合出的完整文档（只读，测试与工具用）。"""
        return self._tree_document

    def page_tree(self, name: str) -> Page:
        """这一页当前的节点树（拉取式 build 或插件交上来的树）；构建期工具用。"""
        return self._page_body(name, self._entry(name))

    def tree(self, page: str | None = None) -> dict[str, Any]:
        """当前页的 V1 树构建输入（base + 局部树）；V1 主路径的迁移桥，构建期同款。

        事件 callable 经 register 换成稳定 handler id；TS 侧 compose 后挂载。
        这里保存 compose 后的文档，作为下一次 tree_event 差分的基准。
        """
        built, document = self._build_tree(page)
        self._tree_document = document
        self._tree_version = int(document.get("version", 1))
        self._tree_seq = 0
        return {"kind": "tree", **built}

    def tree_event(self, handler: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        """派发 handler，并把“上一棵树 → 新树”的差异作为 ops 交回去。"""
        callback = self._tree_handlers.get(handler)
        late = False
        if callback is None:
            callback = self._previous_handlers.get(handler)
            late = callback is not None
        if callback is None:
            self._log.warning("tree.event.unknown", handler=handler)
            raise LookupError(f"未知 handler: {handler}")
        if late:
            self._log.info("tree.event.stale", handler=handler, page=self._active)
        if self._tree_document is None:
            raise RuntimeError("tree 还没挂载")
        self._in_event = True
        try:
            callback({} if payload is None else payload)
        finally:
            self._in_event = False
        before = self._tree_document
        base = self._tree_version
        built, after = self._build_tree(None)
        if needs_full(before, after):
            # 差分表达不了的变化回退整树：直接用这次重建的树，别再 build 一代——
            # 多 build 一次会把上一代 handler 的宽限提前用掉。
            self._tree_document = after
            self._tree_version = int(after.get("version", 1))
            self._tree_seq = 0
            return {"kind": "tree", **built}
        ops = diff_documents(before, after)
        self._tree_document = after
        self._tree_version = base + 1
        self._tree_seq += 1
        return {
            "kind": "ops",
            "document": self._tree_version,
            "base": base,
            "seq": self._tree_seq,
            "ops": ops,
        }

    def _build_tree(self, page: str | None) -> tuple[dict[str, Any], dict[str, Any]]:
        """组装一页的 base + 局部树，并 compose 成可对比的完整文档。"""
        name = self._resolve(page)
        started = time.perf_counter()
        entry = self._entry(name)
        self._rebuild(name)
        self._active = name
        handlers: dict[str, Callable[[dict[str, Any]], None]] = {}

        def register(callback: Callable[[dict[str, Any]], None], node_id: str, event: str) -> str:
            handler = f"tree:{node_id}:{event}"
            handlers[handler] = callback
            return handler

        pages = self.pages()
        nav = [
            NavEntry(
                name=info.name,
                title=info.label,
                icon=info.icon,
                on_click=self._navigate(info.name),
            )
            for info in pages
        ]
        built = build_page(
            name=name,
            title=entry.label,
            route=f"/{name}",
            page=self._page_body(name, entry),
            owner=entry.owner,
            nav=nav,
            register=register,
        )
        self._previous_handlers = self._tree_handlers
        self._tree_handlers = handlers
        self._log.debug(
            "ui.tree",
            page=name,
            ms=(time.perf_counter() - started) * 1000,
        )
        return built, compose(built["base"], built["partials"])

    def _resolve(self, page: str | None) -> str:
        """显式页 → 校验；否则 active（还登记着）→ 第一页。"""
        if page is not None:
            self._entry(page)
            return page
        if self._active is not None and self._active in self._pages:
            return self._active
        if not self._pages:
            raise LookupError("没有登记任何页面")
        return next(iter(self._pages))

    def _navigate(self, target: str) -> Callable[[dict[str, Any]], None]:
        """导航条目点了把当前页切成它；重建后的树由下一次 tree_event 交回去。"""

        def navigate(_payload: dict[str, Any]) -> None:
            self._active = target

        return navigate

    def _entry(self, page: str) -> _Page:
        entry = self._pages.get(page)
        if entry is None:
            raise LookupError(f"未知页面: {page}")
        return entry

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

    def _push(self) -> None:
        """active 页的异步变化：能差分推 ops，表达不了推整树。"""
        if self._ctx is None or self._tree_document is None:
            return
        if self._in_event or self._pushing:
            return
        self._pushing = True
        try:
            before = self._tree_document
            base = self._tree_version
            built, after = self._build_tree(None)
            if needs_full(before, after):
                self._tree_document = after
                self._tree_version = int(after.get("version", 1))
                self._tree_seq = 0
                payload: dict[str, Any] = {"kind": "tree", **built}
            else:
                ops = diff_documents(before, after)
                self._tree_document = after
                self._tree_version = base + 1
                self._tree_seq += 1
                payload = {
                    "kind": "ops",
                    "document": self._tree_version,
                    "base": base,
                    "seq": self._tree_seq,
                    "ops": ops,
                }
            emit(self._ctx, CHANGED_TOPIC, payload)
        finally:
            self._pushing = False


class UiPlugin:
    name = "ui"

    def apply(self, ctx: Context) -> None:
        ctx.provide("ui", Ui(ctx.log, ctx))


__all__ = ["CHANGED_TOPIC", "PageHandle", "PageInfo", "Ui", "UiPlugin"]

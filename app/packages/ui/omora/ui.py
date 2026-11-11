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
from omora.sdk.ui import Handler, Node, Page, serialize

from ._diff import diff_snapshot

Builder = Callable[[], Page]
Counter = Callable[[], int]
ExtraBuilder = Callable[[], Node]


class _Extra:
    """一份贡献：往某个键挂一棵树。归属就是登记它的插件。"""

    __slots__ = ("build", "order", "owner", "seq", "target")

    def __init__(self, owner: str, target: str, order: int, seq: int, build: ExtraBuilder) -> None:
        self.owner = owner
        self.target = target
        self.order = order
        self.seq = seq
        self.build = build


SNAPSHOT_TOPIC = "ui.snapshot"


class _Page:
    def __init__(
        self, label: str, build: Builder | None, count: Counter | None, icon: str | None
    ) -> None:
        self.label = label
        # 两种登记方式：build 回调（拉取式，旧写法）或插件自己 set 上来的树（推送式）。
        self.build = build
        self.tree: Page | None = None
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


class _PageHandle:
    """页面对象：插件自己交树（推送式），不再把 build 回调交给 ui。"""

    def __init__(self, ui: Ui, name: str) -> None:
        self._ui = ui
        self.name = name

    def set(self, page: Page) -> None:
        """交这一页当前的树；客户端正在看它就直接推过去。"""
        self._ui.set_page(self.name, page)

    def refresh(self) -> None:
        """把这一页当前那棵树再交一次（数据变了、树也重建过时用）。"""
        self._ui.refresh_page(self.name)


class Ui:
    def __init__(self, log: Log | None = None, ctx: Context | None = None) -> None:
        self._pages: dict[str, _Page] = {}
        self._log = log if log is not None else NullLog()
        self._ctx = ctx
        # 客户端手里那一份：换页时无法 diff，只能推全量。
        self._current: dict[str, Any] | None = None
        # 别的插件交来的贡献：往某个键挂一棵树。
        self._extras: list[_Extra] = []
        self._seq = 0
        # 事件回调运行期间由 ui 负责推送，set 不要再推一次。
        self._in_event = False
        # 这一页还要订哪些推送 topic：写进快照，客户端按它订阅。
        self._topics: list[str] = []

    def page(  # noqa: PLR0913, PLR0917 —— 页面登记的声明式参数
        self,
        ctx: Context,
        name: str,
        label: str,
        build: Builder | None = None,
        count: Counter | None = None,
        icon: str | None = None,
    ) -> _PageHandle:
        """登记一页；插件卸载时页面跟着消失。icon 是母页面图标栏用的名字。

        返回页面对象：想自己交树就用 `handle.set(Page(...))`；给了 build 回调的就还是拉取式。
        """
        if name in self._pages:
            raise ValueError(f"页面重复登记: {name}")
        self._pages[name] = _Page(label, build, count, icon)

        def remove() -> None:
            self._pages.pop(name, None)

        ctx.effect(remove)
        return _PageHandle(self, name)

    def contribute(self, ctx: Context, target: str, build: ExtraBuilder, *, order: int = 0) -> None:
        """登记一份贡献：往 target 这个键挂一棵树。

        归属取 ctx 的名字（插件名），所以 handler id 里带的是它；插件卸载时贡献一起撤。
        落点存不存在由引擎判断：键不在，引擎丢弃并记日志，这里不算错。
        """
        key = target.strip()
        if not key:
            raise ValueError("贡献的落点不能是空键")
        self._seq += 1
        extra = _Extra(ctx.name, key, order, self._seq, build)
        self._extras.append(extra)

        def remove() -> None:
            if extra in self._extras:
                self._extras.remove(extra)

        ctx.effect(remove)

    def topics(self, ctx: Context, *names: str) -> None:
        """声明还要订哪些推送 topic；插件卸载时一起撤销。"""
        for name in names:
            topic = name.strip()
            if not topic:
                raise ValueError("topic 不能是空串")
            if topic in self._topics:
                continue
            self._topics.append(topic)

            def remove(topic: str = topic) -> None:
                if topic in self._topics:
                    self._topics.remove(topic)

            ctx.effect(remove)

    def set_page(self, name: str, page: Page) -> None:
        """插件交来一页当前的树；客户端正在看它就直接推一次，不等下一次事件。"""
        entry = self._entry(name)
        entry.tree = page
        if self._in_event or self._current is None or self._current.get("page") != name:
            return
        self._push(name, entry, self._draw(name, entry))

    def refresh_page(self, name: str) -> None:
        """把这一页当前那棵树重交给客户端一次（全量兜底）。"""
        entry = self._entry(name)
        if self._current is None or self._current.get("page") != name:
            return
        self._emit(self._deliver(entry, self._draw(name, entry)))

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
                self._in_event = True
                try:
                    callback(payload)
                finally:
                    self._in_event = False
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
        counters: dict[str, int] = {}
        entry.serial += 1
        held = entry.serial
        entry.previous = entry.handlers
        entry.handlers = {}

        def make_register(owner: str) -> Callable[[Handler], str]:
            def register(callback: Handler) -> str:
                index = counters.get(owner, 0)
                counters[owner] = index + 1
                handler = f"{owner}:{held}:{index}"
                entry.handlers[handler] = callback
                return handler

            return register

        page = self._page_body(name, entry)
        pages: list[dict[str, Any]] = []
        for key, item in self._pages.items():
            entry_data: dict[str, Any] = {"name": key, "label": item.label}
            if item.icon is not None:
                entry_data["icon"] = item.icon
            if item.count is not None:
                entry_data["count"] = item.count()
            pages.append(entry_data)

        body: dict[str, Any] = {
            "pages": pages,
            "page": name,
            "meta": page.meta,
            "content": serialize(page.content, make_register(name)),
        }
        extras = self._contributions(make_register)
        if extras:
            # 没有贡献就不写这个键：快照形状对没用到它的页面保持原样。
            body["contributions"] = extras
        if self._topics:
            # 同样的道理：没有额外 topic 就不写，客户端按 ui.snapshot 即可。
            body["topics"] = [SNAPSHOT_TOPIC, *self._topics]
        return body

    def _contributions(
        self, make_register: Callable[[str], Callable[[Handler], str]]
    ) -> list[dict[str, Any]]:
        """把别的插件交来的树摊成贡献；一份坏掉的只跳过它自己，不连累页面。"""
        items: list[dict[str, Any]] = []
        for extra in self._extras:
            try:
                tree = serialize(extra.build(), make_register(extra.owner))
            except Exception as exc:  # 一份贡献坏了不能影响别人的页面
                self._log.warning(
                    "ui.contribution.failed",
                    owner=extra.owner,
                    err=type(exc).__name__,
                )
                continue
            items.append(
                {
                    "owner": extra.owner,
                    "target": extra.target,
                    "op": "append",
                    "order": extra.order,
                    "seq": extra.seq,
                    "tree": tree,
                }
            )
        return items

    def _page_body(self, name: str, entry: _Page) -> Page:
        """这一页现在长什么样：build 回调（拉取）或插件交上来的树（推送）。"""
        if entry.build is not None:
            return entry.build()
        if entry.tree is not None:
            return entry.tree
        raise LookupError(f"页面还没交树: {name}")

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

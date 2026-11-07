"""运行时：把存储、事件日志、投影、注册表接成一台机器。

emit 是唯一写入口：先落日志，再折叠投影，最后按顺序交给监听者。插件只能写
自己那一片投影；读取别人的切片没有入口，这是能力隔离在数据层的落点。
"""

from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable, Mapping, Sequence
from datetime import UTC, datetime
from typing import cast

from .context import Context
from .contract.c1 import Event
from .eventlog import Event as LogEvent
from .eventlog import EventLog
from .projection import Projection
from .registry import CommandRegistry, QueryRegistry
from .store import Store

Reducer = Callable[[dict[str, object], Mapping[str, object]], None]
Listener = Callable[[Event], Awaitable[None]]


class SystemClock:
    """默认时钟；测试注入固定时钟即可去掉时间依赖。"""

    def now(self) -> datetime:
        return datetime.now(UTC)


class UuidGenerator:
    """默认标识符生成器；测试注入序列生成器即可得到确定值。"""

    def next(self) -> str:
        return uuid.uuid4().hex


class Runtime:
    """内核运行时的装配点：注册表、投影、事件日志与监听者。"""

    def __init__(self, store: Store) -> None:
        self._store = store
        self._log = EventLog(store)
        self._projection = Projection()
        self._commands = CommandRegistry()
        self._queries = QueryRegistry()
        self._listeners: list[Listener] = []
        self._owners: dict[str, str] = {}
        self._root = Context("kernel")
        self.ids = UuidGenerator()
        self.clock = SystemClock()

    @property
    def root(self) -> Context:
        return self._root

    @property
    def commands(self) -> CommandRegistry:
        return self._commands

    @property
    def queries(self) -> QueryRegistry:
        return self._queries

    @property
    def revision(self) -> int:
        return self._projection.revision

    async def emit(self, event_type: str, data: Mapping[str, object]) -> int:
        """写入一条事件：落库、折叠投影、按注册顺序通知监听者，返回 revision。"""
        event = self._log.append(event_type, dict(data))
        self._projection.apply(event)
        owner = self._owners.get(event_type)
        wire = Event(
            type=event.type,
            revision=event.revision,
            data=dict(event.data),
            owner=owner,
            state=self.state_slice(owner) if owner is not None else None,
        )
        for listener in tuple(self._listeners):
            await listener(wire)
        return event.revision

    def register_reducer(self, plugin_id: str, event_type: str, reducer: Reducer) -> None:
        """把插件的折叠规则登记到投影里，折叠目标固定是该插件自己的切片。"""

        self._owners[event_type] = plugin_id

        def fold(state: dict[str, object], event: LogEvent) -> None:
            target = state.setdefault(plugin_id, {})
            reducer(cast("dict[str, object]", target), event.data)

        self._projection.register(event_type, fold)

    def state_slice(self, plugin_id: str) -> Mapping[str, object]:
        """返回插件切片的副本；拿不到时给空映射，调用方不必判空。"""
        slice_ = self._projection.state().get(plugin_id)
        if not isinstance(slice_, dict):
            return {}
        return dict(cast("dict[str, object]", slice_))

    def events_since(self, revision: int) -> Sequence[Event]:
        """返回 revision 严格大于给定值的事件，按 revision 升序。"""
        return [
            Event(type=item.type, revision=item.revision, data=dict(item.data))
            for item in self._log.catch_up(revision)
        ]

    def subscribe(self, listener: Listener) -> Callable[[], None]:
        """登记监听者并返回取消函数。"""
        self._listeners.append(listener)

        def unsubscribe() -> None:
            if listener in self._listeners:
                self._listeners.remove(listener)

        return unsubscribe

    def rebuild(self) -> int:
        """按日志重放重建投影；reducer 必须先登记好。返回被跳过的未知事件数。"""
        return self._projection.rebuild(self._log.read())

    def close(self) -> None:
        self._store.close()

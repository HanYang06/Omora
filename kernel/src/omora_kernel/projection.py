"""事件投影：把事件按类型折叠成内核不透明的状态字典。

投影只做折叠，不碰 IO。未知事件类型被跳过并计数，这是前向兼容：旧代码读到新事件
时状态不受影响，但 revision 仍跟随事件推进，调用方据此知道消费到了哪一条。
"""

from __future__ import annotations

from collections.abc import Callable, Iterable

from .eventlog import Event

Reducer = Callable[[dict[str, object], Event], None]


class Projection:
    """可登记 reducer 的事件投影；状态对内核不透明。"""

    def __init__(self) -> None:
        self._reducers: dict[str, Reducer] = {}
        self._state: dict[str, object] = {}
        self._revision = 0
        self._skipped = 0

    def register(self, event_type: str, reducer: Reducer) -> None:
        """登记事件类型的 reducer；同一类型重复登记视为错误。"""
        if event_type in self._reducers:
            raise ValueError(f"事件类型 {event_type!r} 的 reducer 已登记")
        self._reducers[event_type] = reducer

    def apply(self, event: Event) -> bool:
        """折叠一条事件；未知类型跳过并返回 False，revision 始终跟随事件。

        revision 必须严格递增：回退或重复的事件说明调用方没有按日志顺序折叠，
        此时宁可直接报错，也不要把状态悄悄折错。
        """
        if event.revision <= self._revision:
            raise ValueError(f"事件 revision {event.revision} 未大于当前 revision {self._revision}")
        reducer = self._reducers.get(event.type)
        if reducer is None:
            self._skipped += 1
            folded = False
        else:
            reducer(self._state, event)
            folded = True
        self._revision = event.revision
        return folded

    def rebuild(self, events: Iterable[Event]) -> int:
        """清空后从头折叠事件，返回被跳过的未知事件数量；reducer 登记保持不变。"""
        self._state = {}
        self._revision = 0
        self._skipped = 0
        for event in events:
            self.apply(event)
        return self._skipped

    def state(self) -> dict[str, object]:
        """返回状态快照；修改返回值不影响投影内部状态。"""
        return dict(self._state)

    @property
    def revision(self) -> int:
        return self._revision

    @property
    def skipped(self) -> int:
        return self._skipped


class ProjectionSnapshot:
    """把同步投影适配成 C1 的异步快照端口。"""

    def __init__(self, projection: Projection) -> None:
        self._projection = projection

    async def snapshot(self) -> tuple[int, dict[str, object]]:
        """返回 (revision, 状态快照)。"""
        return (self._projection.revision, self._projection.state())

    async def current_revision(self) -> int:
        return self._projection.revision

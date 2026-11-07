"""插件能用的能力面:C2 里"宿主授予什么,插件就能用什么"的 Python 侧声明。"""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Mapping, Sequence
from typing import Protocol

from .ui import Node

Handler = Callable[[Mapping[str, object]], Awaitable[object]]
Listener = Callable[[Mapping[str, object]], Awaitable[None]]
View = Callable[[Mapping[str, object]], Sequence[Node]]


class CommandApi(Protocol):
    """向命令命名空间登记 handler;登记随插件作用域一起回收。"""

    def register(self, name: str, handler: Handler) -> None: ...


class EventApi(Protocol):
    """发布事件与订阅事件;事件是唯一的跨插件通信方式。"""

    def emit(self, event_type: str, data: Mapping[str, object]) -> None: ...

    def subscribe(self, event_type: str, listener: Listener) -> None: ...


class UiApi(Protocol):
    """登记槽位贡献;view 收到的是本插件自己的状态切片。"""

    def contribute(self, contribution_id: str, view: View) -> None: ...


class LogApi(Protocol):
    """日志自动按插件归因。"""

    def info(self, message: str) -> None: ...

    def warn(self, message: str) -> None: ...

    def error(self, message: str) -> None: ...


class PluginContext(Protocol):
    """宿主交给插件的全部东西,不多不少。"""

    plugin_id: str
    commands: CommandApi
    events: EventApi
    ui: UiApi
    log: LogApi

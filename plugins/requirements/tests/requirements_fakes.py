"""requirements 插件测试用的假 PluginContext。

假实现满足 omora_sdk.PluginContext 的形状:id 用确定序列,时钟固定,
replay 模拟内核投影,把发出的事件按顺序折叠进本插件的状态切片。
"""

from __future__ import annotations

from collections.abc import Mapping
from datetime import UTC, datetime

from omora_sdk import (
    ClockApi,
    CommandApi,
    EventApi,
    Handler,
    IdApi,
    Listener,
    LogApi,
    QueryApi,
    Reducer,
    ServiceApi,
    StateApi,
    UiApi,
    View,
)

NOW = datetime(2025, 4, 5, 6, 7, 8, tzinfo=UTC)


class FakeIds:
    """确定性的 id 生成器:连续调用依次返回 requirement-1、requirement-2。"""

    def __init__(self) -> None:
        self.issued: list[str] = []

    def next(self) -> str:
        identifier = f"requirement-{len(self.issued) + 1}"
        self.issued.append(identifier)
        return identifier


class FakeClock:
    """固定时钟:插件读到的"现在"永远不变。"""

    def __init__(self, moment: datetime) -> None:
        self.moment = moment

    def now(self) -> datetime:
        return self.moment


class FakeHandlerApi:
    """命令与查询共用的登记表;invoke 模拟宿主按名字分发。"""

    def __init__(self) -> None:
        self.handlers: dict[str, Handler] = {}

    def register(self, name: str, handler: Handler) -> None:
        self.handlers[name] = handler

    async def invoke(self, name: str, args: Mapping[str, object]) -> object:
        return await self.handlers[name](args)


class FakeEventApi:
    """记录发出的事件与登记过的订阅。"""

    def __init__(self) -> None:
        self.emitted: list[tuple[str, dict[str, object]]] = []
        self.subscriptions: dict[str, list[Listener]] = {}

    async def emit(self, event_type: str, data: Mapping[str, object]) -> None:
        self.emitted.append((event_type, dict(data)))

    def subscribe(self, event_type: str, listener: Listener) -> None:
        self.subscriptions.setdefault(event_type, []).append(listener)


class FakeServiceApi:
    """记录插件提供的服务,并允许测试像消费方一样调用它们。"""

    def __init__(self) -> None:
        self.providers: dict[str, Handler] = {}

    def provide(self, name: str, handler: Handler) -> None:
        self.providers[name] = handler

    async def call(self, name: str, args: Mapping[str, object]) -> object:
        return await self.providers[name](args)


class FakeStateApi:
    """登记折叠规则;read 返回本插件的状态切片,fold 模拟内核投影。"""

    def __init__(self) -> None:
        self.reducers: dict[str, Reducer] = {}
        self.slice: dict[str, object] = {}

    def register(self, event_type: str, reducer: Reducer) -> None:
        self.reducers[event_type] = reducer

    def read(self) -> Mapping[str, object]:
        return self.slice

    def fold(self, event_type: str, data: Mapping[str, object]) -> None:
        reducer = self.reducers.get(event_type)
        if reducer is not None:
            reducer(self.slice, data)


class FakeUiApi:
    def __init__(self) -> None:
        self.contributions: dict[str, View] = {}

    def contribute(self, contribution_id: str, view: View) -> None:
        self.contributions[contribution_id] = view


class FakeLogApi:
    def __init__(self) -> None:
        self.messages: list[tuple[str, str]] = []

    def info(self, message: str) -> None:
        self.messages.append(("info", message))

    def warn(self, message: str) -> None:
        self.messages.append(("warn", message))

    def error(self, message: str) -> None:
        self.messages.append(("error", message))


class FakeContext:
    """满足 omora_sdk.PluginContext 的结构化假实现。

    对外属性按协议类型声明,pyright 因此会校验假实现真的满足协议;
    具体假实现的观测点挂在 fake_* 上,测试用它们做断言。
    """

    plugin_id: str
    commands: CommandApi
    queries: QueryApi
    events: EventApi
    services: ServiceApi
    state: StateApi
    ui: UiApi
    log: LogApi
    ids: IdApi
    clock: ClockApi

    def __init__(self) -> None:
        self.plugin_id = "omora.requirements"
        self.fake_commands = FakeHandlerApi()
        self.fake_queries = FakeHandlerApi()
        self.fake_events = FakeEventApi()
        self.fake_services = FakeServiceApi()
        self.fake_state = FakeStateApi()
        self.fake_ui = FakeUiApi()
        self.commands = self.fake_commands
        self.queries = self.fake_queries
        self.events = self.fake_events
        self.services = self.fake_services
        self.state = self.fake_state
        self.ui = self.fake_ui
        self.log = FakeLogApi()
        self.ids = FakeIds()
        self.clock = FakeClock(NOW)
        self._folded = 0

    def replay(self) -> None:
        """按发出顺序把事件交给登记过的 reducer,模拟内核投影。"""
        for event_type, data in self.fake_events.emitted[self._folded :]:
            self.fake_state.fold(event_type, data)
        self._folded = len(self.fake_events.emitted)

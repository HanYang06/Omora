"""ideas 插件测试的共享替身:假上下文、确定 id、固定时钟与节点查找工具。

假实现满足 omora_sdk.PluginContext 的形状,pyright 因此会校验它真的满足协议。
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, cast

from omora_plugins_ideas import plugin
from omora_sdk import (
    ClockApi,
    CommandApi,
    EventApi,
    Handler,
    IdApi,
    Listener,
    LogApi,
    Node,
    QueryApi,
    Reducer,
    ServiceApi,
    StateApi,
    UiApi,
    View,
)

ROOT = Path(__file__).resolve().parents[3]
NOW = datetime(2025, 4, 5, 6, 7, 8, tzinfo=UTC)


class FakeIds:
    """确定性的 id 生成器:连续调用依次返回 idea-1、idea-2。"""

    def __init__(self) -> None:
        self.issued: list[str] = []

    def next(self) -> str:
        identifier = f"idea-{len(self.issued) + 1}"
        self.issued.append(identifier)
        return identifier


class FakeClock:
    """固定时钟:插件读到的"现在"永远不变。"""

    def __init__(self, moment: datetime) -> None:
        self.moment = moment

    def now(self) -> datetime:
        return self.moment


class FakeCommandApi:
    def __init__(self) -> None:
        self.handlers: dict[str, Handler] = {}

    def register(self, name: str, handler: Handler) -> None:
        self.handlers[name] = handler

    async def invoke(self, name: str, args: Mapping[str, object]) -> object:
        return await self.handlers[name](args)


class FakeQueryApi:
    def __init__(self) -> None:
        self.handlers: dict[str, Handler] = {}

    def register(self, name: str, handler: Handler) -> None:
        self.handlers[name] = handler


class FakeServiceApi:
    """记录调用,按测试预置的回复返回;没预置就报错,避免静默通过。"""

    def __init__(self) -> None:
        self.provided: dict[str, Handler] = {}
        self.calls: list[tuple[str, Mapping[str, object]]] = []
        self.replies: dict[str, object] = {}

    def provide(self, name: str, handler: Handler) -> None:
        self.provided[name] = handler

    async def call(self, name: str, args: Mapping[str, object]) -> object:
        self.calls.append((name, dict(args)))
        if name not in self.replies:
            raise RuntimeError(f"测试没有为服务 {name} 准备回复")
        return self.replies[name]


class FakeEventApi:
    def __init__(self) -> None:
        self.emitted: list[tuple[str, dict[str, object]]] = []
        self.subscriptions: dict[str, list[Listener]] = {}

    async def emit(self, event_type: str, data: Mapping[str, object]) -> None:
        self.emitted.append((event_type, dict(data)))

    def subscribe(self, event_type: str, listener: Listener) -> None:
        self.subscriptions.setdefault(event_type, []).append(listener)


class FakeStateApi:
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

    对外属性按协议类型声明，pyright 因此会校验假实现真的满足协议；
    具体假实现的观测点挂在 fake_* 上，测试用它们做断言。
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
        self.plugin_id = "omora.ideas"
        self.fake_commands = FakeCommandApi()
        self.fake_events = FakeEventApi()
        self.fake_state = FakeStateApi()
        self.fake_ui = FakeUiApi()
        self.fake_queries = FakeQueryApi()
        self.fake_services = FakeServiceApi()
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


def _activated() -> FakeContext:
    context = FakeContext()
    asyncio.run(plugin.activate(context))
    return context


def _load(path: Path) -> dict[str, Any]:
    return cast("dict[str, Any]", json.loads(path.read_text(encoding="utf-8")))


def _manifest() -> dict[str, Any]:
    return _load(ROOT / "plugins" / "ideas" / "plugin.json")


def _find(nodes: Sequence[Node], node_type: str) -> list[Node]:
    """递归找出指定类型的节点。"""
    found = [node for node in nodes if node["type"] == node_type]
    for node in nodes:
        children = node.get("children")
        if isinstance(children, list):
            found.extend(_find(cast("list[Node]", children), node_type))
    return found

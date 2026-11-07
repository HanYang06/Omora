"""插件看到的世界：把宿主的具体实现包成 SDK 里的能力面。

插件只拿到这个上下文，拿不到注册表、作用域或运行时的任何句柄。
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Protocol

import omora_sdk

from .capabilities import Capabilities
from .context import Context
from .providers import ServiceProviders
from .registry import CommandRegistry, QueryRegistry


class HostRuntime(Protocol):
    """宿主依赖的运行时：事件扇出、订阅、reducer 与插件状态切片。"""

    async def emit(self, event_type: str, data: Mapping[str, object]) -> None: ...

    def subscribe(self, event_type: str, listener: omora_sdk.Listener) -> Callable[[], None]: ...

    def register_reducer(
        self, plugin_id: str, event_type: str, reducer: omora_sdk.Reducer
    ) -> None: ...

    def state_slice(self, plugin_id: str) -> Mapping[str, object]: ...


class HostLog(Protocol):
    """宿主日志出口，由集成层注入。"""

    def info(self, message: str) -> None: ...

    def warn(self, message: str) -> None: ...

    def error(self, message: str) -> None: ...


@dataclass
class Activation:
    """一次激活留下的东西：插件对象、它的作用域与已登记的贡献。"""

    plugin: omora_sdk.Plugin
    scope: Context
    declared: Mapping[str, tuple[str, int]]
    views: dict[str, omora_sdk.View]


@dataclass
class PluginEnvironment:
    """构造插件上下文所需的全部依赖；由宿主装配。"""

    plugin_id: str
    scope: Context
    runtime: HostRuntime
    commands: CommandRegistry
    queries: QueryRegistry
    services: ServiceProviders
    sink: HostLog
    ids: omora_sdk.IdApi
    clock: omora_sdk.ClockApi
    declared: Mapping[str, tuple[str, int]]
    views: dict[str, omora_sdk.View]
    capabilities: Capabilities

    def context(self) -> omora_sdk.PluginContext:
        return _Context(
            plugin_id=self.plugin_id,
            commands=_Commands(self.commands, self.scope, self.capabilities),
            queries=_Queries(self.queries, self.scope, self.capabilities),
            events=_Events(self.runtime, self.scope, self.capabilities),
            state=_State(self.runtime, self.plugin_id, self.scope),
            services=_Services(self.services, self.scope, self.capabilities),
            ui=_Ui(self.plugin_id, self.declared, self.views, self.capabilities),
            log=_Log(self.plugin_id, self.sink),
            ids=self.ids,
            clock=self.clock,
        )


@dataclass
class _Commands:
    registry: CommandRegistry
    scope: Context
    capabilities: Capabilities

    def register(self, name: str, handler: omora_sdk.Handler) -> None:
        self.capabilities.require("commands", f"注册命令 {name}")
        self.registry.register(self.scope, name, handler)


@dataclass
class _Queries:
    registry: QueryRegistry
    scope: Context
    capabilities: Capabilities

    def register(self, name: str, handler: omora_sdk.Handler) -> None:
        self.capabilities.require("queries", f"注册查询 {name}")
        self.registry.register(self.scope, name, handler)


@dataclass
class _Events:
    runtime: HostRuntime
    scope: Context
    capabilities: Capabilities

    async def emit(self, event_type: str, data: Mapping[str, object]) -> None:
        self.capabilities.require("events", f"发布事件 {event_type}")
        await self.runtime.emit(event_type, data)

    def subscribe(self, event_type: str, listener: omora_sdk.Listener) -> None:
        self.capabilities.require("events", f"订阅事件 {event_type}")
        unsubscribe = self.runtime.subscribe(event_type, listener)

        async def remove() -> None:
            unsubscribe()

        self.scope.on_dispose(remove)


@dataclass
class _State:
    runtime: HostRuntime
    plugin_id: str
    scope: Context

    def register(self, event_type: str, reducer: omora_sdk.Reducer) -> None:
        enabled = True

        def guarded(state: dict[str, object], data: Mapping[str, object]) -> None:
            if enabled:
                reducer(state, data)

        async def disable() -> None:
            nonlocal enabled
            enabled = False

        self.scope.on_dispose(disable)
        self.runtime.register_reducer(self.plugin_id, event_type, guarded)

    def read(self) -> Mapping[str, object]:
        return self.runtime.state_slice(self.plugin_id)


@dataclass
class _Services:
    providers: ServiceProviders
    scope: Context
    capabilities: Capabilities

    def provide(self, name: str, handler: omora_sdk.Handler) -> None:
        self.capabilities.require("services", f"提供服务 {name}")
        self.providers.provide(self.scope, name, handler)

    async def call(self, name: str, args: Mapping[str, object]) -> object:
        self.capabilities.require("services", f"调用服务 {name}")
        return await self.providers.call(name, args)


@dataclass
class _Ui:
    plugin_id: str
    declared: Mapping[str, tuple[str, int]]
    views: dict[str, omora_sdk.View]
    capabilities: Capabilities

    def contribute(self, contribution_id: str, view: omora_sdk.View) -> None:
        self.capabilities.require("ui", f"贡献界面 {contribution_id}")
        if contribution_id not in self.declared:
            raise ValueError(f"插件 {self.plugin_id} 的贡献 {contribution_id!r} 未在清单中声明")
        self.views[contribution_id] = view


@dataclass
class _Log:
    """日志不受能力限制:用来诊断拒绝的工具不能被拒绝。"""

    plugin_id: str
    sink: HostLog

    def info(self, message: str) -> None:
        self.sink.info(f"[{self.plugin_id}] {message}")

    def warn(self, message: str) -> None:
        self.sink.warn(f"[{self.plugin_id}] {message}")

    def error(self, message: str) -> None:
        self.sink.error(f"[{self.plugin_id}] {message}")


@dataclass
class _Context:
    """SDK 的 PluginContext 的结构化实现；字段名与协议一一对应。"""

    plugin_id: str
    commands: omora_sdk.CommandApi
    queries: omora_sdk.QueryApi
    events: omora_sdk.EventApi
    state: omora_sdk.StateApi
    services: omora_sdk.ServiceApi
    ui: omora_sdk.UiApi
    log: omora_sdk.LogApi
    ids: omora_sdk.IdApi
    clock: omora_sdk.ClockApi

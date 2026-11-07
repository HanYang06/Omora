"""装配：把运行时、插件宿主与 C1 传输接成一台可启动的内核。

这里是唯一知道"谁依赖谁"的地方；各层之间只通过各自的窄 Protocol 说话。
"""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable, Mapping
from pathlib import Path

from .contract.c1 import Event, Snapshot
from .host import PluginHost
from .runtime import Runtime
from .store import Store
from .transport.ws import C1Handlers

LOGGER = logging.getLogger("omora")


class HostLog:
    """把宿主日志接到标准 logging；插件 id 由宿主加前缀。"""

    def info(self, message: str) -> None:
        LOGGER.info(message)

    def warn(self, message: str) -> None:
        LOGGER.warning(message)

    def error(self, message: str) -> None:
        LOGGER.error(message)


class HostRuntimeAdapter:
    """宿主要按事件类型订阅，运行时是全局广播；这里补上过滤。"""

    def __init__(self, runtime: Runtime) -> None:
        self._runtime = runtime

    async def emit(self, event_type: str, data: Mapping[str, object]) -> None:
        await self._runtime.emit(event_type, data)

    def subscribe(
        self, event_type: str, listener: Callable[[Mapping[str, object]], Awaitable[None]]
    ) -> Callable[[], None]:
        async def forward(event: Event) -> None:
            if event.type == event_type:
                await listener(dict(event.data))

        return self._runtime.subscribe(forward)

    def register_reducer(
        self,
        plugin_id: str,
        event_type: str,
        reducer: Callable[[dict[str, object], Mapping[str, object]], None],
    ) -> None:
        self._runtime.register_reducer(plugin_id, event_type, reducer)

    def state_slice(self, plugin_id: str) -> Mapping[str, object]:
        return self._runtime.state_slice(plugin_id)


class KernelApp:
    """一台完整的内核：存储、运行时、插件宿主与 C1 入口。"""

    def __init__(self, database: Path, plugins_dir: Path) -> None:
        self._plugins_dir = plugins_dir
        self._store = Store(database)
        self.runtime = Runtime(self._store)
        self.host = PluginHost(
            HostRuntimeAdapter(self.runtime), HostLog(), self.runtime.ids, self.runtime.clock
        )

    async def start(self) -> tuple[str, ...]:
        """发现并启动插件，然后按事件日志重建投影。"""
        self.host.discover(self._plugins_dir)
        activated = await self.host.start()
        self.runtime.rebuild()
        return activated

    async def snapshot(self) -> Snapshot:
        """C1 快照：数据投影与槽位投影一起给出。"""
        return Snapshot(
            revision=self.runtime.revision, state=self.runtime.state(), ui=self.host.snapshot_ui()
        )

    async def current_revision(self) -> int:
        return self.runtime.revision

    def c1_handlers(self) -> C1Handlers:
        """交给传输层的四个窄接口。"""
        return C1Handlers(
            commands=self.host.commands,
            queries=self.host.queries,
            snapshots=self,
            events=self.runtime,
        )

    async def close(self) -> None:
        await self.host.close()
        self.runtime.close()

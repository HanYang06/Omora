"""M0.5 宿主测试的共享替身:运行时、日志、ID/时钟与临时插件目录。"""

from __future__ import annotations

import json
import sys
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

import pytest
from omora_kernel.host import PluginHost
from omora_sdk import Listener, Reducer


class FakeRuntime:
    """窄运行时替身:记录宿主调用,切片与 reducer 由测试显式驱动。"""

    def __init__(self, slices: Mapping[str, Mapping[str, object]] | None = None) -> None:
        self.slices: dict[str, Mapping[str, object]] = dict(slices or {})
        self.emitted: list[tuple[str, Mapping[str, object]]] = []
        self.listeners: list[tuple[str, Listener, list[bool]]] = []
        self.reducers: list[tuple[str, str, Reducer]] = []
        self.dropped: list[str] = []

    async def emit(self, event_type: str, data: Mapping[str, object]) -> None:
        self.emitted.append((event_type, data))

    def subscribe(self, event_type: str, listener: Listener) -> Callable[[], None]:
        cancelled = [False]
        self.listeners.append((event_type, listener, cancelled))

        def unsubscribe() -> None:
            cancelled[0] = True

        return unsubscribe

    def register_reducer(self, plugin_id: str, event_type: str, reducer: Reducer) -> None:
        self.reducers.append((plugin_id, event_type, reducer))

    def state_slice(self, plugin_id: str) -> Mapping[str, object]:
        return self.slices.get(plugin_id, {})

    def drop_plugin(self, plugin_id: str) -> None:
        self.dropped.append(plugin_id)
        self.slices.pop(plugin_id, None)


class RecordingLog:
    """按调用顺序记录宿主日志。"""

    def __init__(self) -> None:
        self.messages: list[str] = []

    def info(self, message: str) -> None:
        self.messages.append(message)

    def warn(self, message: str) -> None:
        self.messages.append(message)

    def error(self, message: str) -> None:
        self.messages.append(message)


class FakeIds:
    def __init__(self) -> None:
        self._sequence = 0

    def next(self) -> str:
        self._sequence += 1
        return f"id-{self._sequence}"


class FakeClock:
    def __init__(self, moment: datetime) -> None:
        self._moment = moment

    def now(self) -> datetime:
        return self._moment


def make_host(runtime: FakeRuntime, log: RecordingLog) -> PluginHost:
    """用确定的 ID/时钟替身装配宿主;测试不依赖真实时间。"""
    return PluginHost(runtime, log, FakeIds(), FakeClock(datetime(2026, 1, 1)))


@dataclass(frozen=True)
class PluginSpec:
    """写一个临时插件目录所需的全部信息。"""

    directory: str
    module: str
    plugin_id: str
    source: str
    activation: tuple[str, ...] = ("onStartup",)
    engines: str = "^0.1.0"
    capabilities: tuple[str, ...] = ("events", "ui", "commands")
    slots: tuple[dict[str, object], ...] = ()
    commands: tuple[dict[str, object], ...] = ()


def write_plugin(root: Path, spec: PluginSpec, monkeypatch: pytest.MonkeyPatch) -> None:
    """生成 <root>/<directory>/plugin.json 与入口模块,并把目录放进 sys.path。"""
    directory = root / spec.directory
    directory.mkdir(parents=True)
    manifest: dict[str, object] = {
        "id": spec.plugin_id,
        "name": spec.directory,
        "version": "0.1.0",
        "engines": {"omora": spec.engines},
        "runtime": "python",
        "entry": f"{spec.module}:plugin",
        "activation": list(spec.activation),
        "capabilities": list(spec.capabilities),
    }
    contributes: dict[str, object] = {}
    if spec.slots:
        contributes["slots"] = [dict(slot) for slot in spec.slots]
    if spec.commands:
        contributes["commands"] = [dict(command) for command in spec.commands]
    if contributes:
        manifest["contributes"] = contributes
    (directory / "plugin.json").write_text(json.dumps(manifest), encoding="utf-8")
    (directory / f"{spec.module}.py").write_text(spec.source, encoding="utf-8")
    monkeypatch.setattr(sys, "path", [str(directory), *sys.path])


def view_source(label: str) -> str:
    """生成只贡献一个文本节点的插件源码。"""
    return f"""
from omora_sdk import text


class Plugin:
    async def activate(self, context):
        context.ui.contribute("note.panel", self.view)

    async def deactivate(self) -> None:
        pass

    def view(self, state):
        return [text("{label}")]


plugin = Plugin()
"""


NOTE_SOURCE = """
from omora_sdk import text


class Plugin:
    def __init__(self) -> None:
        self.context = None

    async def activate(self, context):
        self.context = context
        context.commands.register("note.create", self.create)
        context.ui.contribute("note.panel", self.view)
        await context.events.emit("note.ready", {"plugin": context.plugin_id})

    async def deactivate(self) -> None:
        self.context.log.info("deactivated")

    async def create(self, args):
        return {"items": [dict(self.context.state.read())]}

    def view(self, state):
        return [text("note")]


plugin = Plugin()
"""

OTHER_SOURCE = """
class Plugin:
    def __init__(self) -> None:
        self.context = None

    async def activate(self, context):
        self.context = context
        context.commands.register("note.other", self.other)

    async def deactivate(self) -> None:
        pass

    async def other(self, args):
        return {"items": [dict(self.context.state.read())]}


plugin = Plugin()
"""

FAILING_SOURCE = """
class Plugin:
    async def activate(self, context):
        context.commands.register("bad.run", self.run)
        raise RuntimeError("boom")

    async def deactivate(self) -> None:
        pass

    async def run(self, args):
        return None


plugin = Plugin()
"""

REDUCER_SOURCE = """
class Plugin:
    def __init__(self) -> None:
        self.context = None

    async def activate(self, context):
        self.context = context
        context.state.register("note.changed", self.reduce)
        context.events.subscribe("note.changed", self.listen)

    async def deactivate(self) -> None:
        pass

    def reduce(self, state, event):
        state["count"] = state.get("count", 0) + event.get("delta", 0)

    async def listen(self, event):
        pass


plugin = Plugin()
"""

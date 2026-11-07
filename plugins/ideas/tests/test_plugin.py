"""ideas 插件的行为测试:用假 PluginContext 记录登记、事件与状态折叠。

假实现满足 omora_sdk.PluginContext 的形状:id 用确定序列,时钟固定,
replay 模拟内核投影,把发出的事件按顺序折叠进本插件的状态切片。
"""

from __future__ import annotations

import asyncio
import copy
import json
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, cast

import jsonschema
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
    Reducer,
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
    events: EventApi
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
        self.commands = self.fake_commands
        self.events = self.fake_events
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


def test_activate_registers_commands_contribution_and_reducers() -> None:
    context = _activated()

    assert set(context.fake_commands.handlers) == {"ideas.create", "ideas.archive"}
    assert set(context.fake_ui.contributions) == {"ideas.sidebar"}
    assert set(context.fake_state.reducers) == {"ideas.created", "ideas.archived"}


def test_create_emits_created_event_with_title_and_injected_id() -> None:
    context = _activated()

    asyncio.run(context.fake_commands.invoke("ideas.create", {"title": "把协议写下来"}))

    assert context.fake_events.emitted == [
        ("ideas.created", {"id": "idea-1", "title": "把协议写下来", "at": NOW.isoformat()})
    ]


def test_create_ids_follow_injected_sequence() -> None:
    context = _activated()

    asyncio.run(context.fake_commands.invoke("ideas.create", {"title": "第一"}))
    asyncio.run(context.fake_commands.invoke("ideas.create", {"title": "第二"}))

    assert [data["id"] for _event, data in context.fake_events.emitted] == ["idea-1", "idea-2"]


def test_created_event_folds_into_items() -> None:
    context = _activated()

    asyncio.run(context.fake_commands.invoke("ideas.create", {"title": "写协议"}))
    context.replay()

    assert context.fake_state.read() == {
        "items": [{"id": "idea-1", "title": "写协议", "at": NOW.isoformat()}]
    }


def test_archived_event_removes_only_that_item() -> None:
    context = _activated()
    asyncio.run(context.fake_commands.invoke("ideas.create", {"title": "保留"}))
    asyncio.run(context.fake_commands.invoke("ideas.create", {"title": "归档"}))
    context.replay()

    asyncio.run(context.fake_commands.invoke("ideas.archive", {"id": "idea-2"}))
    assert context.fake_events.emitted[-1] == ("ideas.archived", {"id": "idea-2"})
    context.replay()

    assert context.fake_state.read() == {
        "items": [{"id": "idea-1", "title": "保留", "at": NOW.isoformat()}]
    }


def test_unknown_event_leaves_items_unchanged() -> None:
    context = _activated()
    asyncio.run(context.fake_commands.invoke("ideas.create", {"title": "写协议"}))
    context.replay()
    before = copy.deepcopy(context.fake_state.read())

    asyncio.run(context.fake_events.emit("ideas.renamed", {"id": "idea-1", "title": "改名"}))
    context.replay()

    assert context.fake_state.read() == before


def test_sidebar_view_passes_c3_schema() -> None:
    context = _activated()
    view = context.fake_ui.contributions["ideas.sidebar"]

    nodes: list[Node] = list(view(context.fake_state.read()))

    assert [node["type"] for node in nodes] == ["Stack"]
    schema = _load(ROOT / "protocol" / "c3-node.schema.json")
    for node in nodes:
        jsonschema.validate(instance=node, schema=schema)


def test_sidebar_input_passes_typed_text_as_title() -> None:
    context = _activated()
    view = context.fake_ui.contributions["ideas.sidebar"]

    inputs = _find(list(view(context.fake_state.read())), "Input")

    assert len(inputs) == 1
    actions = cast("dict[str, object]", inputs[0]["on"])
    assert actions["submit"] == {"command": "ideas.create", "args": {"title": "$value"}}


def test_registered_commands_and_slots_match_manifest() -> None:
    context = _activated()
    payload = _manifest()

    declared_commands = {entry["id"] for entry in payload["contributes"]["commands"]}
    declared_slots = {entry["id"] for entry in payload["contributes"]["slots"]}

    assert set(context.fake_commands.handlers) == declared_commands
    assert set(context.fake_ui.contributions) == declared_slots


def test_manifest_passes_c2_schema() -> None:
    jsonschema.validate(
        instance=_manifest(), schema=_load(ROOT / "protocol" / "c2-manifest.schema.json")
    )


def test_manifest_version_matches_repository_version() -> None:
    expected = (ROOT / "VERSION").read_text(encoding="utf-8").strip()

    assert _manifest()["version"] == expected

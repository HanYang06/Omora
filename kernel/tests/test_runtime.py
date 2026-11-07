"""运行时行为测试：事件是唯一写入口，投影与扇出都必须跟着它走。"""

from __future__ import annotations

import asyncio
from collections.abc import Mapping
from pathlib import Path

from omora_kernel.contract.c1 import Event
from omora_kernel.runtime import Runtime
from omora_kernel.store import Store


def _runtime(tmp_path: Path) -> Runtime:
    return Runtime(Store(tmp_path / "omora.sqlite"))


def _emit(runtime: Runtime, event_type: str, data: Mapping[str, object]) -> int:
    async def run() -> int:
        return await runtime.emit(event_type, data)

    return asyncio.run(run())


def test_emit_assigns_revisions_and_advances_projection(tmp_path: Path) -> None:
    runtime = _runtime(tmp_path)
    first = _emit(runtime, "note.added", {"text": "a"})
    second = _emit(runtime, "note.added", {"text": "b"})
    assert (first, second) == (1, 2), "每次写入都必须拿到新的 revision"
    assert runtime.revision == 2, "投影的 revision 必须跟随最后一条事件"


def test_listeners_receive_events_in_order(tmp_path: Path) -> None:
    runtime = _runtime(tmp_path)
    seen: list[tuple[str, list[int]]] = []

    def make_listener(name: str):  # type: ignore[no-untyped-def]
        revisions: list[int] = []
        seen.append((name, revisions))

        async def listener(event: Event) -> None:
            revisions.append(event.revision)

        return listener

    runtime.subscribe(make_listener("first"))
    runtime.subscribe(make_listener("second"))
    _emit(runtime, "note.added", {"text": "a"})
    _emit(runtime, "note.added", {"text": "b"})
    assert [revisions for _, revisions in seen] == [[1, 2], [1, 2]], "两个监听者都要按顺序收到"


def test_unsubscribe_stops_delivery(tmp_path: Path) -> None:
    runtime = _runtime(tmp_path)
    received: list[int] = []

    async def listener(event: Event) -> None:
        received.append(event.revision)

    unsubscribe = runtime.subscribe(listener)
    _emit(runtime, "note.added", {"text": "a"})
    unsubscribe()
    _emit(runtime, "note.added", {"text": "b"})
    assert received == [1], "取消订阅后不应再收到事件"


def test_events_since_returns_only_later_events(tmp_path: Path) -> None:
    runtime = _runtime(tmp_path)
    _emit(runtime, "note.added", {"text": "a"})
    _emit(runtime, "note.added", {"text": "b"})
    later = runtime.events_since(1)
    assert [event.revision for event in later] == [2], "只返回严格大于给定 revision 的事件"
    assert runtime.events_since(2) == [], "已经追平时不返回任何事件"


def test_plugin_reducers_fold_into_their_own_slice(tmp_path: Path) -> None:
    runtime = _runtime(tmp_path)

    def count(state: dict[str, object], data: Mapping[str, object]) -> None:
        state["count"] = int(str(state.get("count", 0))) + 1

    runtime.register_reducer("plugin.a", "a.bumped", count)
    runtime.register_reducer("plugin.b", "b.bumped", count)
    _emit(runtime, "a.bumped", {})
    _emit(runtime, "b.bumped", {})
    _emit(runtime, "b.bumped", {})
    assert runtime.state_slice("plugin.a") == {"count": 1}, "不同事件类型各折各的"
    assert runtime.state_slice("plugin.b") == {"count": 2}, "同一插件的切片累加"


def test_state_slice_is_detached_from_projection(tmp_path: Path) -> None:
    runtime = _runtime(tmp_path)

    def keep(state: dict[str, object], data: Mapping[str, object]) -> None:
        state["value"] = data["value"]

    runtime.register_reducer("plugin.a", "a.set", keep)
    _emit(runtime, "a.set", {"value": "original"})
    slice_ = dict(runtime.state_slice("plugin.a"))
    slice_["value"] = "tampered"
    assert runtime.state_slice("plugin.a")["value"] == "original", "外部修改不得影响投影"


def test_live_event_carries_updates_for_every_owning_plugin(tmp_path: Path) -> None:
    runtime = _runtime(tmp_path)
    captured: list[Event] = []

    async def listener(event: Event) -> None:
        captured.append(event)

    def keep(state: dict[str, object], data: Mapping[str, object]) -> None:
        state["value"] = data["value"]

    runtime.register_reducer("plugin.a", "note.shared", keep)
    runtime.register_reducer("plugin.b", "note.shared", keep)
    runtime.subscribe(listener)
    _emit(runtime, "note.shared", {"value": "shown"})
    _emit(runtime, "free.form", {})

    assert runtime.state_slice("plugin.a") == {"value": "shown"}, "两个插件都要折叠到自己的切片"
    assert runtime.state_slice("plugin.b") == {"value": "shown"}, "两个插件都要折叠到自己的切片"
    updates = [(update.owner, dict(update.state)) for update in captured[0].updates]
    assert updates == [("plugin.a", {"value": "shown"}), ("plugin.b", {"value": "shown"})]
    assert list(captured[1].updates) == [], "未登记 reducer 的事件不带任何切片更新"


def test_rebuild_restores_projection_after_restart(tmp_path: Path) -> None:
    first = _runtime(tmp_path)

    def keep(state: dict[str, object], data: Mapping[str, object]) -> None:
        state["value"] = data["value"]

    first.register_reducer("plugin.a", "a.set", keep)
    _emit(first, "a.set", {"value": "kept"})
    before = first.state_slice("plugin.a")
    first.close()

    second = _runtime(tmp_path)
    second.register_reducer("plugin.a", "a.set", keep)
    skipped = second.rebuild()
    assert skipped == 0, "重放时不应有未知事件"
    assert second.state_slice("plugin.a") == before, "重放出来的状态必须与关闭前一致"
    assert second.revision == 1, "重放后 revision 要追到最后一条事件"
    second.close()


def test_two_plugins_fold_the_same_event(tmp_path: Path) -> None:
    runtime = _runtime(tmp_path)
    captured: list[Event] = []

    async def listener(event: Event) -> None:
        captured.append(event)

    def bump(state: dict[str, object], data: Mapping[str, object]) -> None:
        state["count"] = int(str(state.get("count", 0))) + 1

    runtime.register_reducer("plugin.a", "shared.bumped", bump)
    runtime.register_reducer("plugin.b", "shared.bumped", bump)
    runtime.subscribe(listener)

    _emit(runtime, "shared.bumped", {})

    assert [update.owner for update in captured[-1].updates] == ["plugin.a", "plugin.b"], (
        "一条事件可以被多个插件折叠,updates 要把它们都带上"
    )
    assert runtime.state_slice("plugin.a") == {"count": 1}
    assert runtime.state_slice("plugin.b") == {"count": 1}


def test_dropping_a_plugin_removes_its_slice_and_stops_folding(tmp_path: Path) -> None:
    runtime = _runtime(tmp_path)
    captured: list[Event] = []

    async def listener(event: Event) -> None:
        captured.append(event)

    def keep(state: dict[str, object], data: Mapping[str, object]) -> None:
        state["value"] = data["value"]

    runtime.register_reducer("plugin.a", "a.set", keep)
    runtime.subscribe(listener)
    _emit(runtime, "a.set", {"value": "before"})

    runtime.drop_plugin("plugin.a")

    assert runtime.state_slice("plugin.a") == {}, "卸载后不能留下幽灵切片"
    _emit(runtime, "a.set", {"value": "after"})
    assert list(captured[-1].updates) == [], "卸载后的插件不该再出现在 updates 里"

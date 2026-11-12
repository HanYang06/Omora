"""设置页：清单怎么读在 test_manager.py，这里只钉页面这一层的行为。

页面把开关接到 manager，改完之后视图变化走 ui.snapshot（协议 §6.1）：
event 的 result 只剩确认，客户端要么应用补丁、要么求一次全量。
"""

from __future__ import annotations

import json
from typing import Any

from omora._metadata import Metadata, PluginRecord
from omora.core.context import Context
from omora.core.kernel import Kernel
from omora.manager import ManagerPlugin
from omora.store import StorePlugin
from omora.ui import UiPlugin


class _Net:
    """net 的替身：记下推出去的东西，不解释。"""

    name = "net"

    def __init__(self) -> None:
        self.sent: list[tuple[str, dict[str, Any]]] = []

    def apply(self, ctx: Context) -> None:
        ctx.provide("net", self)

    def emit(self, topic: str, payload: dict[str, Any], *, coalesce: bool = False) -> None:
        self.sent.append((topic, payload))


class _Plugin:
    def __init__(self, name: str) -> None:
        self.name = name

    def apply(self, ctx: Context) -> None:
        ctx.provide(self.name, self)


class _Host:
    """最小宿主：清单与开关够用，装 / 卸直接落到内核。"""

    def __init__(self, kernel: Kernel, names: tuple[str, ...]) -> None:
        self._kernel = kernel
        self._names = names

    def manifest(self) -> tuple[str, ...]:
        return self._names

    def names(self) -> tuple[str, ...]:
        return self._kernel.names()

    def default_enabled(self, name: str) -> bool:
        return True

    def has_service(self, name: str) -> bool:
        try:
            self._kernel.resolve(name)
        except LookupError:
            return False
        return True

    def install(self, name: str) -> None:
        if name not in self._kernel.names():
            self._kernel.install(_Plugin(name))

    def uninstall(self, name: str) -> None:
        self._kernel.uninstall(name)


class _Service:
    def __init__(self, name: str, value: Any) -> None:
        self.name = name
        self._value = value

    def apply(self, ctx: Context) -> None:
        ctx.provide(self.name, self._value)


class _Catalog:
    def __init__(self, records: dict[str, PluginRecord]) -> None:
        self._records = records

    def names(self) -> tuple[str, ...]:
        return tuple(self._records)

    def record(self, name: str) -> PluginRecord | None:
        return self._records.get(name)


def _record(name: str, *, capabilities: tuple[str, ...] = ()) -> PluginRecord:
    return PluginRecord(
        name,
        "0.1.0",
        f"{name} 插件",
        Metadata(platforms=(), capabilities=capabilities, listed=True, requires=()),
    )


def _scene() -> Kernel:
    records = {
        "store": _record("store"),
        "manager": _record("manager"),
        "ui": _record("ui"),
        "audio": _record("audio", capabilities=("microphone",)),
        "notes": _record("notes"),
    }
    order = tuple(records)
    kernel = Kernel()
    kernel.install(StorePlugin(":memory:"))
    kernel.install(UiPlugin())
    kernel.install(_Net())
    kernel.install(_Service("host", _Host(kernel, order)))
    kernel.install(ManagerPlugin(catalog=_Catalog(records), platform="win32"))
    return kernel


def _items(node: dict[str, Any]) -> list[dict[str, Any]]:
    found = [node] if node["type"] == "item" else []
    for child in node["children"]:
        found.extend(_items(child))
    return found


def _find_item(node: dict[str, Any], title: str) -> dict[str, Any] | None:
    if node["type"] == "item" and node["props"].get("title") == title:
        return node
    for child in node["children"]:
        found = _find_item(child, title)
        if found is not None:
            return found
    return None


def _find_action(node: dict[str, Any], label: str) -> str | None:
    if node["type"] == "button" and node["props"].get("text") == label:
        return str(node["props"]["on_click"])
    for child in node["children"]:
        handler = _find_action(child, label)
        if handler is not None:
            return handler
    return None


def _all_text(node: dict[str, Any]) -> str:
    parts = [str(node["props"].get("text", ""))]
    parts.extend(_all_text(child) for child in node["children"])
    return " ".join(parts)


def test_the_settings_page_lists_plugins_and_its_toggle_changes_one() -> None:
    kernel = _scene()
    ui = kernel.resolve("ui")

    snapshot = ui.render("plugins")
    titles = [row["props"]["title"] for row in _items(snapshot["content"])]
    assert titles == ["store", "manager", "ui", "audio", "notes"]
    assert snapshot["meta"] == "5/5 运行中"
    audio = _find_item(snapshot["content"], "audio")
    assert audio is not None
    text = _all_text(audio)
    assert "需要: microphone" in text
    assert _find_action(audio, "禁用") is not None

    notes = _find_item(snapshot["content"], "notes")
    assert notes is not None
    disable = _find_action(notes, "禁用")
    assert disable is not None

    assert ui.event(disable, {}) == {}

    net: _Net = kernel.resolve("net")
    topic, pushed = net.sent[-1]
    assert topic == "ui.snapshot"
    assert pushed["page"] == "plugins"
    assert pushed["version"] > pushed["base"], "补丁的版本必须往上走"
    assert pushed["ops"], "设置页的开关变化至少要有一个补丁 op"

    after = ui.render("plugins")
    notes_after = _find_item(after["content"], "notes")
    assert notes_after is not None
    assert _find_action(notes_after, "启用") is not None
    assert kernel.running("notes") is False


def test_a_device_report_pushes_the_settings_page_when_it_is_open() -> None:
    kernel = _scene()
    ui = kernel.resolve("ui")
    net = kernel.resolve("net")

    ui.render("plugins")
    before = len(net.sent)

    kernel.resolve("manager").report_devices(["audioinput"])

    assert len(net.sent) == before + 1
    assert "audioinput" in json.dumps(net.sent[-1], ensure_ascii=False)

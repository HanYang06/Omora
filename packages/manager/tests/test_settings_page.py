"""设置页：清单怎么读在 test_manager.py，这里只钉页面这一层的行为。

页面把开关接到 manager；事件的结果是 V1 树的 ops / 整树回退，设备上报改变下一次 tree() 的内容。
"""

from __future__ import annotations

import json
from typing import Any, cast

from omora._metadata import Metadata, PluginRecord
from omora.core.context import Context
from omora.core.kernel import Kernel
from omora.manager import ManagerPlugin
from omora.store import StorePlugin
from omora.ui import UiPlugin

PAGE_MOUNT_AT = "dendro.window.page"


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


def _find_tree_node(node: dict[str, Any], node_id: str) -> dict[str, Any] | None:
    if node["id"] == node_id:
        return node
    for child in node["layout"]:
        found = _find_tree_node(child, node_id)
        if found is not None:
            return found
    return None


def _as_slot(node: dict[str, Any]) -> dict[str, Any]:
    """V1 节点 → 测试视图节点（kind / props / events / children）。"""
    return {
        "kind": "dendro:" + str(node["kind"]),
        "props": dict(node["settings"]),
        "events": dict(node["on"]),
        "children": [_as_slot(child) for child in node["layout"]],
    }


def _adapt_tree(ui: Any, frame: dict[str, Any] | None = None) -> dict[str, Any]:
    """把 ui 当前这棵树摊成旧 view 形状，测试体只认页面内容。"""
    document = ui.current_document
    if document is None:
        raise AssertionError("tree 还没构建")
    page = _find_tree_node(document["root"], document["active"])
    if page is None:
        raise AssertionError("tree 里没有 active 页")
    return {
        "kind": "view",
        "version": 1,
        "frame": frame,
        "pages": [
            {"id": "page." + info.name, "label": info.label, "owner": info.owner}
            for info in ui.pages()
        ],
        "localTrees": {
            "trees": [
                {
                    "mountAt": PAGE_MOUNT_AT,
                    "root": {
                        "kind": "dendro:page",
                        "props": {},
                        "events": {},
                        "children": [_as_slot(page["layout"][0])],
                    },
                }
            ]
        },
    }


def _tree_view(ui: Any, page: str | None = None) -> dict[str, Any]:
    """整页兜底：重建当前页（或指定页）。"""
    if page is None:
        ui.tree()
    else:
        ui.tree(page)
    return _adapt_tree(ui)


def _walk(slot: dict[str, Any]) -> list[dict[str, Any]]:
    found = [slot]
    for child in slot["children"]:
        found.extend(_walk(child))
    return found


def _content(view: dict[str, Any]) -> dict[str, Any]:
    for tree in cast(list[dict[str, Any]], view["localTrees"]["trees"]):
        if tree["mountAt"] == PAGE_MOUNT_AT:
            return cast(dict[str, Any], tree["root"]["children"][0])
    raise AssertionError("view 里没有页面局部树")


def _items(view: dict[str, Any]) -> list[dict[str, Any]]:
    return [slot for slot in _walk(_content(view)) if slot["kind"] == "dendro:item"]


def _find_item(view: dict[str, Any], title: str) -> dict[str, Any] | None:
    for item in _items(view):
        if item["props"].get("title") == title:
            return item
    return None


def _find_action(view: dict[str, Any], node: dict[str, Any], label: str) -> str | None:
    for slot in _walk(node):
        if slot["kind"] == "dendro:button" and slot["props"].get("text") == label:
            return str(slot["events"]["click"])
    return None


def _all_text(node: dict[str, Any]) -> str:
    parts = [str(node["props"].get("text", ""))]
    parts.extend(_all_text(child) for child in node["children"])
    return " ".join(parts)


def test_the_settings_page_lists_plugins_and_its_toggle_changes_one() -> None:
    kernel = _scene()
    ui = kernel.resolve("ui")
    net: _Net = kernel.resolve("net")

    view = _tree_view(ui, "plugins")
    assert [row["props"]["title"] for row in _items(view)] == [
        "store",
        "manager",
        "ui",
        "audio",
        "notes",
    ]
    audio = _find_item(view, "audio")
    assert audio is not None
    assert "需要: microphone" in _all_text(audio)
    assert _find_action(view, audio, "禁用") is not None

    notes = _find_item(view, "notes")
    assert notes is not None
    disable = _find_action(view, notes, "禁用")
    assert disable is not None

    frame = ui.tree_event(disable, {})
    after = _adapt_tree(ui, frame)

    assert net.sent == []
    assert after["kind"] == "view"
    assert after["frame"]["kind"] in {"ops", "tree"}
    if after["frame"]["kind"] == "ops":
        assert after["frame"]["document"] == after["frame"]["base"] + 1
    notes_after = _find_item(after, "notes")
    assert notes_after is not None
    assert _find_action(after, notes_after, "启用") is not None
    assert kernel.running("notes") is False


def test_a_device_report_updates_the_next_settings_tree() -> None:
    kernel = _scene()
    ui = kernel.resolve("ui")
    before = _tree_view(ui, "plugins")
    assert "audioinput" not in json.dumps(before, ensure_ascii=False)

    kernel.resolve("manager").report_devices(["audioinput"])

    after = _tree_view(ui, "plugins")
    assert "audioinput" in json.dumps(after, ensure_ascii=False)

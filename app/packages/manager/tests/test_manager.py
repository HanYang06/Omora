"""manager 的行为测试：清单、条件、开关、卸载清理、设置页。"""

from __future__ import annotations

from typing import Any

import pytest

from omora._metadata import Metadata, MetadataError, PluginRecord
from omora.core.context import Context
from omora.core.kernel import Kernel
from omora.manager import ACTIVE, DISABLED, FAILED, LOADING, PENDING, ManagerPlugin
from omora.store import StorePlugin
from omora.ui import UiPlugin

SETTINGS = "settings"


class FakeCatalog:
    def __init__(self, records: dict[str, PluginRecord]) -> None:
        self._records = records

    def names(self) -> tuple[str, ...]:
        return tuple(self._records)

    def record(self, name: str) -> PluginRecord | None:
        return self._records.get(name)


class BrokenCatalog(FakeCatalog):
    """某一行元数据读坏了：manager 应该把它报成 failed，不拖垮别的。"""

    def record(self, name: str) -> PluginRecord | None:
        if name == "broken-meta":
            raise MetadataError("tool.omora.capabilities 必须是字符串列表")
        return super().record(name)


class FakePlugin:
    def __init__(self, name: str) -> None:
        self.name = name

    def apply(self, ctx: Context) -> None:
        ctx.provide(self.name, self)


class EffectPlugin:
    """装时登记一个撤销动作，用来证明卸载真的把东西撤干净了。"""

    def __init__(self, name: str, log: list[str]) -> None:
        self.name = name
        self._log = log

    def apply(self, ctx: Context) -> None:
        self._log.append(f"apply:{self.name}")
        ctx.provide(self.name, self)
        ctx.effect(lambda: self._log.append(f"dispose:{self.name}"))


class BrokenPlugin:
    def __init__(self, name: str) -> None:
        self.name = name

    def apply(self, ctx: Context) -> None:
        raise RuntimeError("boom")


class ProbePlugin:
    """装自己的时候看一眼清单，把阶段快照留下来。"""

    def __init__(self, name: str, seen: list[dict[str, tuple[str, bool]]]) -> None:
        self.name = name
        self._seen = seen

    def apply(self, ctx: Context) -> None:
        inventory = ctx.resolve("manager").inventory()
        self._seen.append(
            {row["name"]: (row["phase"], row["enabled"]) for row in inventory["plugins"]}
        )
        ctx.provide(self.name, self)


class _ServicePlugin:
    def __init__(self, name: str, value: Any) -> None:
        self.name = name
        self._value = value

    def apply(self, ctx: Context) -> None:
        ctx.provide(self.name, self._value)


class FakeHost:
    """manager 眼里的宿主；真宿主由 boot 提供并另有测试。"""

    def __init__(
        self,
        kernel: Kernel,
        names: tuple[str, ...],
        factories: dict[str, Any],
        defaults: dict[str, bool] | None = None,
    ) -> None:
        self._kernel = kernel
        self._names = names
        self._factories = factories
        self._defaults = defaults or {}

    def manifest(self) -> tuple[str, ...]:
        return self._names

    def names(self) -> tuple[str, ...]:
        return self._kernel.names()

    def default_enabled(self, name: str) -> bool:
        return self._defaults.get(name, True)

    def has_service(self, name: str) -> bool:
        try:
            self._kernel.resolve(name)
        except LookupError:
            return False
        return True

    def install(self, name: str) -> None:
        if name in self._kernel.names():
            return
        self._kernel.install(self._factories[name])

    def uninstall(self, name: str) -> None:
        self._kernel.uninstall(name)


def _record(
    name: str,
    *,
    platforms: tuple[str, ...] = (),
    capabilities: tuple[str, ...] = (),
    listed: bool = True,
    requires: tuple[str, ...] = (),
) -> PluginRecord:
    return PluginRecord(
        name,
        "0.1.0",
        f"{name} 插件",
        Metadata(
            platforms=platforms,
            capabilities=capabilities,
            listed=listed,
            requires=requires,
        ),
    )


def _scene(
    records: dict[str, PluginRecord],
    *,
    order: tuple[str, ...] | None = None,
    defaults: dict[str, bool] | None = None,
    platform: str = "win32",
    ui: bool = False,
    factories: dict[str, Any] | None = None,
    catalog: FakeCatalog | None = None,
) -> tuple[Kernel, Any]:
    """一个最小的宿主：真 store + 假 host + 真 manager。"""
    names = order or tuple(records)
    kernel = Kernel()
    kernel.install(StorePlugin(":memory:"))
    if ui:
        kernel.install(UiPlugin())
    built = factories or {name: FakePlugin(name) for name in names}
    host = FakeHost(kernel, names, built, defaults)
    kernel.install(_ServicePlugin("host", host))
    kernel.install(ManagerPlugin(catalog=catalog or FakeCatalog(records), platform=platform))
    return kernel, kernel.resolve("manager")


def _rows(inventory: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {row["name"]: row for row in inventory["plugins"]}


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


def test_inventory_reports_metadata_state_and_conditions() -> None:
    records = {
        "store": _record("store"),
        "manager": _record("manager", requires=("store",)),
        "ideas": _record("ideas", requires=("store",)),
        "hidden": _record("hidden", listed=False),
    }
    kernel, manager = _scene(records, order=("store", "manager", "ideas", "hidden"))

    inventory = manager.inventory()
    rows = _rows(inventory)

    assert inventory["platform"] == "win32"
    assert inventory["reported"] is False
    assert [row["name"] for row in inventory["plugins"]] == [
        "store",
        "manager",
        "ideas",
        "hidden",
    ]
    assert rows["ideas"] == {
        "name": "ideas",
        "version": "0.1.0",
        "description": "ideas 插件",
        "bootstrap": False,
        "listed": True,
        "default_enabled": True,
        "enabled": True,
        "phase": ACTIVE,
        "reason": None,
        "conditions": {"platforms": [], "capabilities": [], "requires": ["store"]},
    }
    assert rows["hidden"]["listed"] is False
    assert rows["store"]["bootstrap"] is True
    assert rows["manager"]["phase"] == ACTIVE
    assert kernel.running("ideas")


def test_pending_and_loading_are_visible_while_the_manager_starts() -> None:
    seen: list[dict[str, tuple[str, bool]]] = []
    records = {name: _record(name) for name in ("store", "manager", "probe", "later")}
    kernel, manager = _scene(
        records,
        order=("store", "manager", "probe", "later"),
        factories={
            "store": FakePlugin("store"),
            "manager": FakePlugin("manager"),
            "probe": ProbePlugin("probe", seen),
            "later": FakePlugin("later"),
        },
    )

    assert seen[0]["store"] == (ACTIVE, True)
    assert seen[0]["manager"] == (ACTIVE, True)
    assert seen[0]["probe"] == (LOADING, True)
    assert seen[0]["later"] == (PENDING, True)
    assert _rows(manager.inventory())["probe"]["phase"] == ACTIVE
    assert kernel.running("later")


def test_unsupported_platform_disables_with_a_reason() -> None:
    records = {
        "store": _record("store"),
        "manager": _record("manager"),
        "win-only": _record("win-only", platforms=("win32",)),
    }
    linux, linux_manager = _scene(records, platform="linux")
    windows, windows_manager = _scene(records, platform="win32")

    linux_row = _rows(linux_manager.inventory())["win-only"]
    assert linux_row["phase"] == DISABLED
    assert linux_row["enabled"] is False
    assert linux_row["reason"] == {
        "code": "unsupported-platform",
        "message": "linux 不在 win32",
    }
    assert linux.running("win-only") is False

    windows_row = _rows(windows_manager.inventory())["win-only"]
    assert windows_row["phase"] == ACTIVE
    assert windows.running("win-only")


def test_a_missing_capability_keeps_the_plugin_off_until_a_client_reports_it() -> None:
    records = {
        "store": _record("store"),
        "manager": _record("manager"),
        "audio": _record("audio", capabilities=("microphone",)),
    }
    kernel, manager = _scene(records)

    before = _rows(manager.inventory())["audio"]
    assert before["phase"] == DISABLED
    assert before["reason"] == {
        "code": "missing-capability",
        "message": "缺少能力: microphone",
    }
    assert kernel.running("audio") is False

    reported = manager.report_capabilities(["microphone"])
    assert reported["reported"] is True
    assert reported["capabilities"] == ["microphone"]
    assert _rows(reported)["audio"]["phase"] == ACTIVE
    assert kernel.running("audio")


def test_a_later_client_without_the_capability_does_not_disable_the_plugin() -> None:
    records = {
        "store": _record("store"),
        "manager": _record("manager"),
        "camera": _record("camera", capabilities=("camera",)),
    }
    kernel, manager = _scene(records)
    manager.report_capabilities(["camera"])

    after = manager.report_capabilities([])

    assert after["capabilities"] == []
    assert after["reported"] is True
    assert _rows(after)["camera"]["phase"] == ACTIVE
    assert _rows(after)["camera"]["reason"] is None
    assert kernel.running("camera")


def test_a_plugin_with_an_unmet_service_requirement_stays_disabled() -> None:
    records = {
        "store": _record("store"),
        "manager": _record("manager"),
        "reader": _record("reader", requires=("media",)),
    }
    _kernel, manager = _scene(records)

    row = _rows(manager.inventory())["reader"]

    assert row["phase"] == DISABLED
    assert row["reason"] == {"code": "missing-service", "message": "缺少服务: media"}

    with_media = dict(records)
    with_media["media"] = _record("media")
    kernel, manager = _scene(with_media, order=("store", "manager", "media", "reader"))

    assert _rows(manager.inventory())["reader"]["phase"] == ACTIVE
    assert kernel.running("reader")


def test_toggling_a_plugin_off_uninstalls_it_and_undoes_its_effects() -> None:
    log: list[str] = []
    records = {name: _record(name) for name in ("store", "manager", "probe")}
    kernel, manager = _scene(
        records,
        factories={
            "store": FakePlugin("store"),
            "manager": FakePlugin("manager"),
            "probe": EffectPlugin("probe", log),
        },
    )
    assert log == ["apply:probe"]

    after = manager.set_enabled("probe", False)

    assert kernel.running("probe") is False
    assert log == ["apply:probe", "dispose:probe"]
    assert _rows(after)["probe"]["phase"] == DISABLED
    assert _rows(after)["probe"]["reason"] == {
        "code": "disabled-by-setting",
        "message": "被设置关掉了",
    }
    with pytest.raises(LookupError):
        kernel.resolve("probe")

    again = manager.set_enabled("probe", True)
    assert _rows(again)["probe"]["phase"] == ACTIVE
    assert kernel.running("probe")
    assert log == ["apply:probe", "dispose:probe", "apply:probe"]


def test_the_toggle_is_persisted_in_the_store_and_survives_a_manager_restart() -> None:
    records = {name: _record(name) for name in ("store", "manager", "ideas")}
    kernel, manager = _scene(records)
    manager.set_enabled("ideas", False)

    settings = kernel.resolve("store").collection(
        SETTINGS, fields={"plugin": "text", "enabled": "bool"}, indexes=["plugin"]
    )
    assert [row.enabled for row in settings.find({"plugin": "ideas"})] == [False]

    kernel.uninstall("manager")
    kernel.install(ManagerPlugin(catalog=FakeCatalog(records), platform="win32"))
    restarted = kernel.resolve("manager")

    assert kernel.running("ideas") is False
    assert _rows(restarted.inventory())["ideas"]["phase"] == DISABLED
    assert _rows(restarted.inventory())["ideas"]["reason"] == {
        "code": "disabled-by-setting",
        "message": "被设置关掉了",
    }


def test_a_failing_install_is_a_failed_row_and_the_rest_still_install() -> None:
    records = {name: _record(name) for name in ("store", "manager", "boom", "later")}
    kernel, manager = _scene(
        records,
        factories={
            "store": FakePlugin("store"),
            "manager": FakePlugin("manager"),
            "boom": BrokenPlugin("boom"),
            "later": FakePlugin("later"),
        },
    )

    row = _rows(manager.inventory())["boom"]
    assert row["phase"] == FAILED
    assert row["enabled"] is True
    assert row["reason"] == {"code": "install-failed", "message": "boom"}
    assert kernel.running("boom") is False
    assert kernel.running("later")


def test_unreadable_metadata_is_a_failed_row() -> None:
    records = {name: _record(name) for name in ("store", "manager", "broken-meta")}
    _kernel, manager = _scene(records, catalog=BrokenCatalog(records))

    row = _rows(manager.inventory())["broken-meta"]

    assert row["phase"] == FAILED
    assert row["enabled"] is False
    assert row["reason"]["code"] == "invalid-metadata"
    assert "capabilities" in row["reason"]["message"]


def test_bootstrap_plugins_cannot_be_toggled_and_unknown_names_are_rejected() -> None:
    records = {name: _record(name) for name in ("store", "manager", "ideas")}
    _kernel, manager = _scene(records)

    with pytest.raises(ValueError, match="启动项不能开关: store"):
        manager.set_enabled("store", False)
    with pytest.raises(LookupError, match="未知插件: nope"):
        manager.set_enabled("nope", True)
    with pytest.raises(TypeError, match="enabled 必须是 bool"):
        manager.set_enabled("ideas", "yes")


def test_a_capability_report_must_be_a_list_of_strings() -> None:
    records = {name: _record(name) for name in ("store", "manager")}
    _kernel, manager = _scene(records)

    with pytest.raises(TypeError, match="capabilities 必须是字符串列表"):
        manager.report_capabilities([1])
    with pytest.raises(TypeError, match="capabilities 必须是字符串列表"):
        manager.report_capabilities("microphone")


def test_the_settings_page_lists_plugins_and_its_toggle_changes_one() -> None:
    records = {
        "store": _record("store"),
        "manager": _record("manager"),
        "ui": _record("ui"),
        "audio": _record("audio", capabilities=("microphone",)),
        "notes": _record("notes"),
    }
    kernel, _manager = _scene(
        records,
        order=("store", "manager", "ui", "audio", "notes"),
        ui=True,
    )
    ui = kernel.resolve("ui")

    snapshot = ui.render("plugins")
    titles = [row["props"]["title"] for row in _items(snapshot["content"])]
    assert titles == ["store", "manager", "ui", "audio", "notes"]
    assert snapshot["meta"] == "4/5 运行中"
    audio = _find_item(snapshot["content"], "audio")
    assert audio is not None
    text = _all_text(audio)
    assert "能力: microphone" in text
    assert "缺少能力: microphone" in text
    assert _find_action(audio, "启用") is not None

    notes = _find_item(snapshot["content"], "notes")
    assert notes is not None
    disable = _find_action(notes, "禁用")
    assert disable is not None
    after = ui.event(disable, {})
    notes_after = _find_item(after["content"], "notes")
    assert notes_after is not None
    assert _find_action(notes_after, "启用") is not None
    assert kernel.running("notes") is False


def _items(node: dict[str, Any]) -> list[dict[str, Any]]:
    found = [node] if node["type"] == "item" else []
    for child in node["children"]:
        found.extend(_items(child))
    return found


def _all_text(node: dict[str, Any]) -> str:
    parts = [str(node["props"].get("text", ""))]
    for child in node["children"]:
        parts.append(_all_text(child))
    return " ".join(parts)

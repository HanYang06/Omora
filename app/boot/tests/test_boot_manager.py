"""boot 的顺序：store + manager 先装，其余由 manager 按条件与开关装。"""

from collections.abc import Mapping
from pathlib import Path
from typing import Any

import pytest

from boot import Config, build, load_plugin
from main import SYSTEM_PLUGINS
from omora._metadata import Metadata, PluginRecord
from omora.core.context import Context
from omora.manager import ManagerPlugin
from omora.store import StorePlugin

# 带能力条件的插件：客户端上报能力之前 manager 不会装它们。
CAPABILITY_GATED = {"audio", "video"}


class _Fake:
    def __init__(self, name: str, **config: Any) -> None:
        self.name = name
        self.config = config

    def apply(self, ctx: Context) -> None:
        ctx.provide(self.name, self)


class _Catalog:
    def __init__(self, records: dict[str, PluginRecord]) -> None:
        self._records = records

    def names(self) -> tuple[str, ...]:
        return tuple(self._records)

    def record(self, name: str) -> PluginRecord | None:
        return self._records.get(name)


def _record(name: str) -> PluginRecord:
    return PluginRecord(name, "0.1.0", f"{name} 插件", Metadata())


def _loader(records: dict[str, PluginRecord], calls: list[str]) -> Any:
    catalog = _Catalog(records)

    def load(name: str, settings: Mapping[str, Any]) -> Any:
        calls.append(name)
        if name == "store":
            return StorePlugin(":memory:")
        if name == "manager":
            return ManagerPlugin(catalog=catalog, platform="win32")
        return _Fake(name, **settings)

    return load


def test_boot_installs_store_then_manager_and_the_manager_installs_the_rest() -> None:
    calls: list[str] = []
    records = {name: _record(name) for name in ("store", "manager", "a", "b")}

    kernel = build(
        Config({}),
        ("store", "manager", "a", "b"),
        loader=_loader(records, calls),
    )

    assert calls == ["store", "manager", "a", "b"]
    assert kernel.running("a") and kernel.running("b")
    assert kernel.resolve("manager").inventory()["plugins"][0]["name"] == "store"


def test_a_plugin_disabled_in_config_is_only_a_default_for_the_manager() -> None:
    calls: list[str] = []
    records = {name: _record(name) for name in ("store", "manager", "a", "b")}
    config = Config({"b": {"enabled": False}})

    kernel = build(config, ("store", "manager", "a", "b"), loader=_loader(records, calls))

    assert calls == ["store", "manager", "a"]
    assert kernel.running("b") is False
    inventory = kernel.resolve("manager").inventory()
    row = {item["name"]: item for item in inventory["plugins"]}["b"]
    assert row["phase"] == "disabled"
    assert row["reason"]["code"] == "disabled-by-default"
    assert config.unclaimed() == []


def test_the_store_setting_wins_over_the_config_default_after_a_restart() -> None:
    calls: list[str] = []
    records = {name: _record(name) for name in ("store", "manager", "a")}
    settings = {"a": {"enabled": False}}

    kernel = build(Config(settings), ("store", "manager", "a"), loader=_loader(records, calls))
    manager = kernel.resolve("manager")
    manager.set_enabled("a", True)

    assert kernel.running("a")
    row = {item["name"]: item for item in manager.inventory()["plugins"]}["a"]
    assert row["phase"] == "active"
    assert row["default_enabled"] is False


def test_without_a_manager_boot_falls_back_to_the_old_ordered_install() -> None:
    calls: list[str] = []
    records = {name: _record(name) for name in ("store", "manager", "a", "b")}
    config = Config({"manager": {"enabled": False}})

    kernel = build(config, ("store", "manager", "a", "b"), loader=_loader(records, calls))

    assert calls == ["store", "a", "b"]
    assert kernel.running("manager") is False
    assert kernel.running("a") and kernel.running("b")
    with pytest.raises(LookupError):
        kernel.resolve("host")


def test_the_real_manifest_is_installed_through_the_manager(tmp_path: Path) -> None:
    calls: list[str] = []

    def loader(name: str, settings: Mapping[str, Any]) -> Any:
        calls.append(name)
        return load_plugin(name, settings)

    config = Config(
        {
            "store": {"path": str(tmp_path / "omora.db")},
            "media": {"root": str(tmp_path / "media")},
        }
    )
    kernel = build(config, SYSTEM_PLUGINS, loader=loader)
    # audio / video 带能力条件：客户端上报之前不装，所以先按"去掉它们"的顺序钉。
    assert calls == [name for name in SYSTEM_PLUGINS if name not in CAPABILITY_GATED]

    kernel.resolve("manager").report_capabilities(["microphone", "camera"])

    assert sorted(calls) == sorted(SYSTEM_PLUGINS)
    inventory = kernel.resolve("manager").inventory()
    rows = {row["name"]: row for row in inventory["plugins"]}
    assert [row["name"] for row in inventory["plugins"]] == list(SYSTEM_PLUGINS)
    assert rows["store"]["bootstrap"] is True
    assert rows["manager"]["bootstrap"] is True
    assert all(row["phase"] == "active" for row in rows.values())
    assert rows["ideas"]["conditions"]["requires"] == ["store", "media", "ui"]
    pages = kernel.resolve("ui").render()["pages"]
    assert "plugins" in [page["name"] for page in pages]

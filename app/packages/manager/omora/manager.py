"""manager：插件清单、条件检查与开关。

系统插件。它持有"哪些插件装了、能不能开、现在是什么状态"，但自己不碰内核：
装、卸、名单都走 boot 提供的 host 服务。条件来自各 package 的 [tool.omora]；
开关存在 store 的 settings collection 里——config.ini 只提供默认值，且只读。

生命周期只有一个来源：这里的 phase + reason。插件的健康状态不进 inventory。
"""

from __future__ import annotations

import sys
from collections.abc import Callable
from typing import Any, Protocol

from omora.sdk import Context
from omora.sdk.ui import Page

from ._metadata import Catalog, InstalledCatalog, Metadata, MetadataError, PluginRecord
from ._model import ACTIVE, DISABLED, FAILED, LOADING, PENDING, Reason, Row
from ._settings import build_page

BOOTSTRAP = ("store", "manager")
SETTINGS = "settings"


class Host(Protocol):
    """boot 提供的宿主接口：manager 只通过它动手。"""

    def manifest(self) -> tuple[str, ...]: ...
    def names(self) -> tuple[str, ...]: ...
    def install(self, name: str) -> None: ...
    def uninstall(self, name: str) -> None: ...
    def has_service(self, name: str) -> bool: ...
    def default_enabled(self, name: str) -> bool: ...


class Manager:
    """插件清单 + 条件 + 开关；生命周期只有这一份。"""

    def __init__(
        self,
        ctx: Context,
        host: Host,
        store: Any,
        *,
        catalog: Catalog | None = None,
        platform: str | None = None,
    ) -> None:
        self._ctx = ctx
        self._host = host
        self._catalog = catalog or InstalledCatalog()
        self._platform = platform or sys.platform
        self._manifest = host.manifest()
        self._settings = store.collection(
            SETTINGS,
            fields={"plugin": "text", "enabled": "bool"},
            indexes=["plugin"],
        )
        self._toggles = {
            str(row.plugin): bool(row.enabled) for row in self._settings.find(limit=200)
        }
        self._records: dict[str, PluginRecord | None] = {}
        self._record_errors: dict[str, str] = {}
        self._phase = dict.fromkeys(self._manifest, PENDING)
        self._reason: dict[str, Reason | None] = dict.fromkeys(self._manifest)
        self._enabled: dict[str, bool] = {}
        # 客户端上报的设备事实（平台名字：audioinput / videoinput）；manager 不解释它。
        self._devices: tuple[str, ...] = ()
        self._reported = False
        self._owned: set[str] = set()
        self._ui: Any = None
        self._page: Any = None

    # 生命周期

    def start(self) -> None:
        self._recompute()
        self._sync_page()
        self._refresh()

    def stop(self) -> None:
        for name in reversed(self._manifest):
            if name in self._owned:
                self._host.uninstall(name)
        self._owned.clear()
        self._phase = dict.fromkeys(self._manifest, DISABLED)
        self._reason = {
            name: Reason("manager-stopped", "manager 已卸载") for name in self._manifest
        }
        self._enabled = dict.fromkeys(self._manifest, False)
        self._ui = None
        self._page = None

    # 对外服务：net 按方法名转发这三件事

    def inventory(self) -> dict[str, Any]:
        """读清单：装的、开的、阶段、原因。只读快照。"""
        return {
            "platform": self._platform,
            "devices": list(self._devices),
            "reported": self._reported,
            "plugins": [self._row(name).to_dict() for name in self._manifest],
        }

    def set_enabled(self, name: str, enabled: bool) -> dict[str, Any]:
        """改一个插件的开关；写进 store，然后按条件重算。"""
        if name not in self._phase:
            raise LookupError(f"未知插件: {name}")
        if name in BOOTSTRAP:
            raise ValueError(f"启动项不能开关: {name}")
        if not isinstance(enabled, bool):
            raise TypeError("enabled 必须是 bool")
        self._remember(name, enabled)
        self._recompute()
        self._sync_page()
        self._refresh()
        return self.inventory()

    def report_devices(self, devices: list[str] | tuple[str, ...]) -> dict[str, Any]:
        """收客户端上报的设备事实；manager 只存，不解释、也不拿它决定装不装。"""
        if not isinstance(devices, (list, tuple)) or not all(
            isinstance(item, str) and item for item in devices
        ):
            raise TypeError("devices 必须是字符串列表")
        self._devices = tuple(dict.fromkeys(devices))
        self._reported = True
        self._recompute()
        self._sync_page()
        self._refresh()
        return self.inventory()

    def devices(self) -> tuple[str, ...]:
        """最近一次上报的设备种类；插件按它自己判断要不要出捕捉界面。"""
        return self._devices

    def reported(self) -> bool:
        """客户端报过设备事实没有；没报过时插件不该急着藏界面。"""
        return self._reported

    # 重算

    def _recompute(self) -> None:
        for name in self._manifest:
            if name in BOOTSTRAP:
                # manager 正在 apply 里，内核还没把它记进插件表；它就是自己。
                running = name == "manager" or name in self._host.names()
                self._phase[name] = ACTIVE if running else DISABLED
                self._reason[name] = (
                    None if running else Reason("bootstrap-missing", f"{name} 应由 boot 装好")
                )
                self._enabled[name] = running
                continue
            self._apply(name)

    def _apply(self, name: str) -> None:
        record = self._record(name)
        error = self._record_errors.get(name)
        if error is not None:
            self._disable(name, FAILED, Reason("invalid-metadata", error))
            return
        if record is None:
            self._disable(name, FAILED, Reason("missing-plugin", f"入口点里没有 {name}"))
            return
        condition = self._check(record.metadata)
        if condition is not None:
            self._disable(name, DISABLED, condition)
            return
        if not self._wanted(name):
            self._disable(name, DISABLED, self._off_reason(name))
            return
        if name in self._host.names():
            self._phase[name] = ACTIVE
            self._reason[name] = None
            self._enabled[name] = True
            return
        self._phase[name] = LOADING
        self._reason[name] = None
        self._enabled[name] = True
        try:
            self._host.install(name)
        except Exception as exc:
            self._phase[name] = FAILED
            self._reason[name] = Reason("install-failed", str(exc))
            return
        self._owned.add(name)
        self._phase[name] = ACTIVE

    def _disable(self, name: str, phase: str, reason: Reason) -> None:
        if name in self._host.names():
            self._host.uninstall(name)
        self._owned.discard(name)
        self._phase[name] = phase
        self._reason[name] = reason
        self._enabled[name] = False

    def _check(self, metadata: Metadata) -> Reason | None:
        if metadata.platforms and self._platform not in metadata.platforms:
            return Reason(
                "unsupported-platform",
                f"{self._platform} 不在 {'/'.join(metadata.platforms) or '空'}",
            )
        lacking = [service for service in metadata.requires if not self._host.has_service(service)]
        if lacking:
            return Reason("missing-service", "缺少服务: " + ", ".join(lacking))
        return None

    def _wanted(self, name: str) -> bool:
        return self._toggles.get(name, self._host.default_enabled(name))

    def _off_reason(self, name: str) -> Reason:
        if name in self._toggles:
            return Reason("disabled-by-setting", "被设置关掉了")
        return Reason("disabled-by-default", "默认关闭")

    def _remember(self, name: str, enabled: bool) -> None:
        rows = self._settings.find({"plugin": name}, limit=1)
        if rows:
            self._settings.update(rows[0].id, enabled=enabled)
        else:
            self._settings.add(plugin=name, enabled=enabled)
        self._toggles[name] = enabled

    # 清单行

    def _record(self, name: str) -> PluginRecord | None:
        if name not in self._records:
            try:
                self._records[name] = self._catalog.record(name)
            except MetadataError as exc:
                self._record_errors[name] = str(exc)
                self._records[name] = None
        return self._records[name]

    def _intent(self, name: str) -> bool:
        record = self._record(name)
        if record is None or name in self._record_errors:
            return False
        if self._check(record.metadata) is not None:
            return False
        return self._wanted(name)

    def _row(self, name: str) -> Row:
        record = self._record(name)
        return Row(
            name=name,
            version=record.version if record is not None else "",
            description=record.description if record is not None else "",
            metadata=record.metadata if record is not None else Metadata(),
            bootstrap=name in BOOTSTRAP,
            default_enabled=True if name in BOOTSTRAP else self._host.default_enabled(name),
            enabled=self._enabled.get(name, self._intent(name)),
            phase=self._phase[name],
            reason=self._reason[name],
        )

    # 设置页

    def _refresh(self) -> None:
        """状态变了就把设置页的树重交一次；客户端没在看这一页时 ui 不会推。"""
        if self._page is not None:
            self._page.set(self._build_page())

    def _sync_page(self) -> None:
        if not self._ctx.has("ui"):
            return
        ui = self._ctx.resolve("ui")
        if ui is self._ui:
            return
        self._page = ui.page(
            self._ctx,
            "plugins",
            "插件",
            count=lambda: len(self._manifest),
            icon="settings",
        )
        self._page.set(self._build_page())
        self._ui = ui

    def _build_page(self) -> Page:
        return build_page(
            [self._row(name) for name in self._manifest],
            devices=self._devices,
            reported=self._reported,
            toggler=self._toggler,
        )

    def _toggler(self, name: str) -> Callable[[dict[str, Any]], None]:
        def toggle(_payload: dict[str, Any]) -> None:
            self.set_enabled(name, not self._row(name).enabled)

        return toggle


class ManagerPlugin:
    name = "manager"

    def __init__(self, *, catalog: Catalog | None = None, platform: str | None = None) -> None:
        self._catalog = catalog
        self._platform = platform

    def apply(self, ctx: Context) -> None:
        host: Host = ctx.resolve("host")
        store: Any = ctx.resolve("store")
        manager = Manager(ctx, host, store, catalog=self._catalog, platform=self._platform)
        ctx.effect(manager.stop)
        ctx.provide("manager", manager)
        manager.start()


__all__ = [
    "ACTIVE",
    "BOOTSTRAP",
    "DISABLED",
    "FAILED",
    "LOADING",
    "PENDING",
    "Manager",
    "ManagerPlugin",
    "Reason",
    "Row",
]

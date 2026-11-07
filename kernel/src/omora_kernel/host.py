"""插件宿主：发现、校验、激活与卸载；每个插件一个作用域，卸载零残留。

宿主只依赖 HostRuntime 窄运行时（事件、订阅、reducer、状态切片）；每个插件拿到 child
Context，命令、查询、服务、订阅、reducer 与 UI 贡献都挂在上面，deactivate 时精确回收。
插件能看见什么，由 plugin_context 决定。
"""

from __future__ import annotations

import importlib
import json
from pathlib import Path
from typing import cast

import omora_sdk

from .capabilities import Capabilities
from .context import Context, UnavailableError
from .contract.c2 import EngineIncompatibleError, InvalidManifestError, validate_manifest
from .plugin_context import Activation, HostLog, HostRuntime, PluginEnvironment
from .providers import ServiceProviders
from .registry import CommandRegistry, QueryRegistry


class PluginHost:
    """插件的发现与生命周期；插件之间的唯一联系是事件与服务注册表。"""

    def __init__(
        self, runtime: HostRuntime, log: HostLog, ids: omora_sdk.IdApi, clock: omora_sdk.ClockApi
    ) -> None:
        self._runtime = runtime
        self._log = log
        self._ids = ids
        self._clock = clock
        self._root = Context("host")
        self.commands = CommandRegistry()
        self.queries = QueryRegistry()
        self._services = ServiceProviders()
        self._discovered: dict[str, omora_sdk.Manifest] = {}
        self._active: dict[str, Activation] = {}

    @property
    def services(self) -> ServiceProviders:
        return self._services

    def discover(self, plugins_dir: str | Path) -> tuple[str, ...]:
        """扫描 <dir>/*/plugin.json；坏清单与不兼容引擎跳过并记日志。"""
        found: list[str] = []
        for manifest_path in sorted(Path(plugins_dir).glob("*/plugin.json")):
            manifest = self._read_manifest(manifest_path)
            if manifest is None:
                continue
            if manifest.id in self._discovered:
                self._log.warn(f"插件 id 重复，忽略 {manifest.id}: {manifest_path}")
                continue
            self._discovered[manifest.id] = manifest
            found.append(manifest.id)
        return tuple(found)

    async def start(self) -> tuple[str, ...]:
        """激活 activation 含 onStartup 的插件；单个失败不影响其余插件。"""
        activated: list[str] = []
        for plugin_id, manifest in self._discovered.items():
            if "onStartup" not in manifest.activation:
                continue
            try:
                await self.activate(plugin_id)
            except Exception as error:
                self._log.error(f"插件 {plugin_id} 激活失败: {error}")
                continue
            activated.append(plugin_id)
        return tuple(activated)

    async def activate(self, plugin_id: str) -> None:
        """激活一个已发现的插件；失败时回滚它已登记的切面并原样上抛。"""
        if plugin_id in self._active:
            return
        manifest = self._discovered.get(plugin_id)
        if manifest is None:
            raise UnavailableError(plugin_id, "插件未发现")
        scope = self._root.child(plugin_id)
        plugin = self._load_plugin(plugin_id, manifest.entry)
        declared = _declared_slots(manifest)
        views: dict[str, omora_sdk.View] = {}
        environment = PluginEnvironment(
            plugin_id=plugin_id,
            scope=scope,
            runtime=self._runtime,
            commands=self.commands,
            queries=self.queries,
            services=self._services,
            sink=self._log,
            ids=self._ids,
            clock=self._clock,
            declared=declared,
            views=views,
            capabilities=Capabilities(manifest.capabilities),
        )
        try:
            await plugin.activate(environment.context())
        except Exception:
            await scope.dispose()
            raise
        self._active[plugin_id] = Activation(plugin, scope, declared, views)
        self._log.info(f"插件已激活: {plugin_id}")

    async def deactivate(self, plugin_id: str) -> None:
        """卸载插件：先让它自行清理，再释放作用域，命令/服务/订阅/贡献零残留。"""
        activation = self._active.get(plugin_id)
        if activation is None:
            if plugin_id in self._discovered:
                return
            raise UnavailableError(plugin_id, "插件未发现")
        try:
            await activation.plugin.deactivate()
        finally:
            await activation.scope.dispose()
            del self._active[plugin_id]
            self._log.info(f"插件已卸载: {plugin_id}")

    async def close(self) -> None:
        """卸载全部活跃插件并释放宿主作用域。"""
        try:
            for plugin_id in tuple(self._active):
                await self.deactivate(plugin_id)
        finally:
            await self._root.dispose()

    def snapshot_ui(self) -> dict[str, object]:
        """按清单声明的 order 汇总所有活跃插件的槽位贡献。"""
        entries: list[tuple[int, str, str, str, omora_sdk.View]] = []
        for plugin_id, activation in self._active.items():
            for contribution_id, view in activation.views.items():
                declared = activation.declared.get(contribution_id)
                if declared is None:
                    continue
                slot, order = declared
                entries.append((order, plugin_id, contribution_id, slot, view))
        slots: dict[str, list[object]] = {}
        for _, plugin_id, _, slot, view in sorted(
            entries, key=lambda entry: (entry[0], entry[1], entry[2])
        ):
            nodes = [dict(node) for node in view(self._runtime.state_slice(plugin_id))]
            slots.setdefault(slot, []).append({"owner": plugin_id, "nodes": nodes})
        return {"slots": slots, "commands": self._active_commands()}

    def _active_commands(self) -> list[dict[str, object]]:
        """已激活插件在清单里声明的命令，供命令面板之类的前端入口使用。"""
        commands: list[dict[str, object]] = []
        for plugin_id in sorted(self._active):
            raw = self._discovered[plugin_id].contributes.get("commands")
            if not isinstance(raw, list):
                continue
            for entry in cast("list[dict[str, object]]", raw):
                command_id = entry.get("id")
                title = entry.get("title")
                if isinstance(command_id, str) and isinstance(title, str):
                    commands.append({"owner": plugin_id, "id": command_id, "title": title})
        return commands

    def _read_manifest(self, path: Path) -> omora_sdk.Manifest | None:
        try:
            payload: object = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            self._log.warn(f"无法读取清单 {path}: {error}")
            return None
        if not isinstance(payload, dict):
            self._log.warn(f"清单必须是 JSON 对象: {path}")
            return None
        try:
            return validate_manifest(cast("dict[str, object]", payload))
        except (InvalidManifestError, EngineIncompatibleError) as error:
            self._log.warn(f"跳过插件 {path}: {error}")
            return None

    def _load_plugin(self, plugin_id: str, entry: str) -> omora_sdk.Plugin:
        module_name, _, attr_path = entry.partition(":")
        try:
            target: object = importlib.import_module(module_name)
            for part in attr_path.split("."):
                target = getattr(target, part)
        except (ImportError, AttributeError) as error:
            raise RuntimeError(f"插件 {plugin_id} 入口无法加载: {entry}") from error
        if not (
            callable(getattr(target, "activate", None))
            and callable(getattr(target, "deactivate", None))
        ):
            raise RuntimeError(f"插件 {plugin_id} 入口不满足 Plugin 形状: {entry}")
        return cast("omora_sdk.Plugin", target)


def _declared_slots(manifest: omora_sdk.Manifest) -> dict[str, tuple[str, int]]:
    raw = manifest.contributes.get("slots")
    if not isinstance(raw, list):
        return {}
    declared: dict[str, tuple[str, int]] = {}
    for entry in cast("list[dict[str, object]]", raw):
        contribution_id = entry.get("id")
        slot = entry.get("slot")
        order = entry.get("order", 0)
        if isinstance(contribution_id, str) and isinstance(slot, str) and isinstance(order, int):
            declared[contribution_id] = (slot, order)
    return declared

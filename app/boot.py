"""boot：读配置 → 按序构造插件 → 装进内核。

它站在内核和所有插件外面：唯一知道"有哪些插件、什么顺序"的地方。
内核看不到配置；插件看不到 boot。

装法有两段：boot 先装 store + manager，再把 Host 服务交给 manager；
其余插件由 manager 按元数据条件与 store 里的开关来装、来卸。
manager 不 import 内核：装 / 卸 / 名单都走 Host。
"""

from __future__ import annotations

import configparser
from collections.abc import Callable, Mapping, Sequence
from importlib.metadata import entry_points
from pathlib import Path
from typing import Any

import yaml

from omora.core.kernel import Kernel, Plugin

Loader = Callable[[str, Mapping[str, Any]], Plugin]

BOOTSTRAP = ("store", "manager")

_FALSE = {"false", "0", "no", "off", "none", ""}


class Config:
    """合并之后的配置。按插件名取自己那一段；谁取过谁就算认领。"""

    def __init__(self, merged: dict[str, dict[str, Any]]) -> None:
        self._merged = merged
        self._claimed: set[str] = set()

    def enabled(self, name: str) -> bool:
        """这个插件默认开不开。manager 手里它只是默认值。"""
        self._claimed.add(name)
        return _as_bool(self._merged.get(name, {}).get("enabled", True))

    def for_plugin(self, name: str) -> dict[str, Any]:
        """插件自己的那一段，去掉 enabled。没写就是空。"""
        self._claimed.add(name)
        section = dict(self._merged.get(name, {}))
        section.pop("enabled", None)
        return section

    def unclaimed(self) -> list[str]:
        """合并之后没有任何插件认领的段。"""
        return sorted(set(self._merged) - self._claimed)


def load_config(system: Path, user: Path | None = None) -> Config:
    """读系统配置，再用用户配置逐键覆盖。"""
    if not system.exists():
        raise FileNotFoundError(f"缺少系统配置: {system}")

    merged: dict[str, dict[str, Any]] = {}
    parser = configparser.ConfigParser(interpolation=None)
    parser.read_string(system.read_text(encoding="utf-8"), source=str(system))
    for section in parser.sections():
        merged[section] = dict(parser.items(section))

    if user is not None and user.exists():
        raw = yaml.safe_load(user.read_text(encoding="utf-8"))
        if raw is None:
            return Config(merged)
        if not isinstance(raw, dict):
            raise ValueError(f"用户配置必须是映射: {user}")
        _deep_merge(merged, raw)

    return Config(merged)


def load_plugin(name: str, settings: Mapping[str, Any]) -> Plugin:
    """按入口点找插件：入口在插件自己的 pyproject 里，boot 只认名字。"""
    matches = [entry for entry in entry_points(group="omora.plugins") if entry.name == name]
    if not matches:
        raise LookupError(f"缺少插件入口: {name}")
    factory = matches[0].load()
    plugin: Plugin = factory(**settings)
    if plugin.name != name:
        raise ValueError(f"插件入口 {name} 与插件 name {plugin.name} 不一致")
    return plugin


class Host:
    """boot 交给 manager 的宿主接口：装、卸、名单、默认开关。

    内核仍然是宿主；manager 只通过这里动手，不拿 Kernel。
    """

    def __init__(
        self,
        kernel: Kernel,
        manifest: Sequence[str],
        defaults: Mapping[str, bool],
        load: Loader,
        config: Config,
    ) -> None:
        self._kernel = kernel
        self._manifest = tuple(manifest)
        self._defaults = dict(defaults)
        self._load = load
        self._config = config

    def manifest(self) -> tuple[str, ...]:
        """boot 声明的顺序；manager 按这个顺序装。"""
        return self._manifest

    def names(self) -> tuple[str, ...]:
        """现在装着的插件。"""
        return self._kernel.names()

    def default_enabled(self, name: str) -> bool:
        """config.ini 提供的默认开关；store 里的值可以覆盖它。"""
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
        plugin = self._load(name, self._config.for_plugin(name))
        self._kernel.install(plugin)

    def uninstall(self, name: str) -> None:
        self._kernel.uninstall(name)


class _HostPlugin:
    """把 Host 挂到服务表上的最小插件；它不在 manifest 里。"""

    name = "host"

    def __init__(self, host: Host) -> None:
        self._host = host

    def apply(self, ctx: Any) -> None:
        ctx.provide("host", self._host)


def build(
    config: Config,
    manifest: Sequence[str],
    *,
    loader: Loader | None = None,
) -> Kernel:
    """按 manifest 的顺序装。store + manager 先装，其余交给 manager。"""
    kernel = Kernel()
    load = loader or load_plugin
    names = tuple(manifest)
    defaults = {name: config.enabled(name) for name in names}

    if "manager" in names and defaults["manager"]:
        kernel.install(_HostPlugin(Host(kernel, names, defaults, load, config)))
        for name in names:
            if name in BOOTSTRAP and defaults[name]:
                _install(kernel, load, config, name)
        if kernel.running("manager"):
            return kernel

    # 没有 manager（或被配置关掉）：回到 boot 自己按序装，应用以降级形态起。
    for name in names:
        if kernel.running(name) or not defaults[name]:
            continue
        _install(kernel, load, config, name)
    return kernel


def _install(kernel: Kernel, load: Loader, config: Config, name: str) -> None:
    try:
        plugin = load(name, config.for_plugin(name))
    except Exception as exc:
        exc.add_note(f'插件 "{name}" 装载失败')
        raise
    kernel.install(plugin)


def _deep_merge(base: dict[str, Any], override: Mapping[str, Any]) -> None:
    for key, value in override.items():
        current = base.get(key)
        if isinstance(value, Mapping) and isinstance(current, dict):
            _deep_merge(current, value)
        else:
            base[key] = value


def _as_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() not in _FALSE
    return bool(value)

"""boot：读配置 → 按序构造插件 → 装进内核。

它站在内核和所有插件外面：唯一知道"有哪些插件、什么顺序"的地方。
内核看不到配置；插件看不到 boot。
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

_FALSE = {"false", "0", "no", "off", "none", ""}


class Config:
    """合并之后的配置。按插件名取自己那一段；谁取过谁就算认领。"""

    def __init__(self, merged: dict[str, dict[str, Any]]) -> None:
        self._merged = merged
        self._claimed: set[str] = set()

    def enabled(self, name: str) -> bool:
        """这个插件开不开，默认开。"""
        self._claimed.add(name)
        return _as_bool(self._merged.get(name, {}).get("enabled", True))

    def for_plugin(self, name: str) -> dict[str, Any]:
        """插件自己的那一段，去掉 `enabled`。没写就是空。"""
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


def build(
    config: Config,
    manifest: Sequence[str],
    *,
    loader: Loader | None = None,
) -> Kernel:
    """按 manifest 的顺序装；装不上就带着插件名失败。"""
    kernel = Kernel()
    load = loader or load_plugin
    for name in manifest:
        if not config.enabled(name):
            continue
        try:
            plugin = load(name, config.for_plugin(name))
        except Exception as exc:
            exc.add_note(f'插件 "{name}" 装载失败')
            raise
        kernel.install(plugin)
    return kernel


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

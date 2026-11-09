"""读已安装插件的 [tool.omora] 元数据。

manager 只认四个键：platforms / capabilities / listed / requires。
元数据从入口点模块旁边的 pyproject.toml 读——它是 package 的声明，
不是运行期状态；读不到或类型不对都算元数据错误，由 manager 报出来。
"""

from __future__ import annotations

import importlib.util
import tomllib
from dataclasses import dataclass, field
from importlib.metadata import EntryPoint, entry_points
from pathlib import Path
from typing import Any, Protocol

GROUP = "omora.plugins"


class MetadataError(Exception):
    """元数据读不出来或形状不对。"""


@dataclass(frozen=True)
class Metadata:
    """一个插件的 [tool.omora]：省略即默认。"""

    platforms: tuple[str, ...] = ()
    capabilities: tuple[str, ...] = ()
    listed: bool = True
    requires: tuple[str, ...] = ()


@dataclass(frozen=True)
class PluginRecord:
    """插件清单里的一行来源：身份 + 显示信息 + 条件。"""

    name: str
    version: str
    description: str
    metadata: Metadata = field(default_factory=Metadata)


class Catalog(Protocol):
    """manager 需要的"装了哪些插件、各自什么元数据"。测试里可替换。"""

    def names(self) -> tuple[str, ...]: ...

    def record(self, name: str) -> PluginRecord | None: ...


class InstalledCatalog:
    """真实实现：入口点决定名字，package 的 pyproject 决定元数据。"""

    def __init__(self, group: str = GROUP) -> None:
        self._entries: dict[str, EntryPoint] = {
            entry.name: entry for entry in entry_points(group=group)
        }

    def names(self) -> tuple[str, ...]:
        return tuple(self._entries)

    def record(self, name: str) -> PluginRecord | None:
        entry = self._entries.get(name)
        if entry is None:
            return None
        module = entry.value.split(":", 1)[0]
        path = _pyproject_for(module)
        if path is None:
            raise MetadataError(f"{name}: 找不到 pyproject.toml（入口点 {entry.value}）")
        raw = tomllib.loads(path.read_text(encoding="utf-8"))
        project = raw.get("project")
        tool = raw.get("tool")
        metadata = parse_metadata(tool.get("omora") if isinstance(tool, dict) else None)
        version = project.get("version", "") if isinstance(project, dict) else ""
        description = project.get("description", "") if isinstance(project, dict) else ""
        if not isinstance(version, str) or not isinstance(description, str):
            raise MetadataError(f"{name}: pyproject 的 version / description 必须是字符串")
        return PluginRecord(name, version, description, metadata)


def parse_metadata(raw: object) -> Metadata:
    """把 [tool.omora] 表解析成 Metadata；未知键忽略，已知键严格校验。"""
    if raw is None:
        return Metadata()
    if not isinstance(raw, dict):
        raise MetadataError("[tool.omora] 必须是表")

    return Metadata(
        platforms=_strings(raw, "platforms"),
        capabilities=_strings(raw, "capabilities"),
        listed=_boolean(raw, "listed", True),
        requires=_strings(raw, "requires"),
    )


def _strings(raw: dict[str, Any], key: str) -> tuple[str, ...]:
    value = raw.get(key, [])
    if not isinstance(value, list) or not all(isinstance(item, str) and item for item in value):
        raise MetadataError(f"tool.omora.{key} 必须是非空字符串的列表")
    return tuple(dict.fromkeys(value))


def _boolean(raw: dict[str, Any], key: str, default: bool) -> bool:
    value = raw.get(key, default)
    if not isinstance(value, bool):
        raise MetadataError(f"tool.omora.{key} 必须是 bool")
    return value


def _pyproject_for(module: str) -> Path | None:
    """入口点模块 → 最近的 pyproject.toml（package 根）。"""
    spec = importlib.util.find_spec(module)
    if spec is None or spec.origin is None:
        return None
    for parent in Path(spec.origin).parents:
        candidate = parent / "pyproject.toml"
        if candidate.is_file():
            return candidate
    return None


__all__ = [
    "Catalog",
    "InstalledCatalog",
    "Metadata",
    "MetadataError",
    "PluginRecord",
    "parse_metadata",
]

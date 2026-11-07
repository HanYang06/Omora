"""C2 清单的 Python 视图。

这里只做形状检查;完整校验(能力目录、激活事件语法、引擎范围)由宿主按 schema 做。
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import cast


class ManifestError(ValueError):
    """清单缺少字段或字段类型不对。"""


@dataclass(frozen=True)
class Manifest:
    id: str
    name: str
    version: str
    entry: str
    runtime: str
    engines: Mapping[str, str]
    activation: tuple[str, ...]
    capabilities: frozenset[str]
    contributes: Mapping[str, object]


def _text(data: Mapping[str, object], key: str) -> str:
    value = data.get(key)
    if not isinstance(value, str) or not value:
        raise ManifestError(f"清单字段 {key} 必须是非空字符串")
    return value


def _texts(data: Mapping[str, object], key: str) -> tuple[str, ...]:
    value = data.get(key)
    if not isinstance(value, list) or not value:
        raise ManifestError(f"清单字段 {key} 必须是非空数组")
    items = cast("list[object]", value)
    if not all(isinstance(item, str) for item in items):
        raise ManifestError(f"清单字段 {key} 只能包含字符串")
    return tuple(cast("list[str]", items))


def parse_manifest(data: Mapping[str, object]) -> Manifest:
    """把清单字典转成不可变视图;字段缺失或类型不符直接报错。"""
    engines = data.get("engines")
    if not isinstance(engines, dict):
        raise ManifestError("清单字段 engines 必须是对象")
    contributes = data.get("contributes")
    if contributes is not None and not isinstance(contributes, dict):
        raise ManifestError("清单字段 contributes 必须是对象")
    return Manifest(
        id=_text(data, "id"),
        name=_text(data, "name"),
        version=_text(data, "version"),
        entry=_text(data, "entry"),
        runtime=_text(data, "runtime"),
        engines={key: str(value) for key, value in cast("dict[str, object]", engines).items()},
        activation=_texts(data, "activation"),
        capabilities=frozenset(_texts(data, "capabilities")),
        contributes=cast("Mapping[str, object]", contributes) if contributes else {},
    )

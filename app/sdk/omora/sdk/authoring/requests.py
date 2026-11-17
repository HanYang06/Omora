"""节点作用域的请求、响应与稳定错误码。

形状唯一来源是 `schema/sdk/scope.json`；这里把契约固化成 Python 常量，
测试再读契约逐项对齐，防止实现悄悄漂移。
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from enum import StrEnum
from types import MappingProxyType
from typing import Any

ERROR_CODES: frozenset[str] = frozenset(
    {
        "E-SCOPE-PARENT",
        "E-SCOPE-CYCLE",
        "E-SCOPE-DUP-MOUNT",
        "E-SCOPE-NOT-CHILD",
        "E-SCOPE-MOVE-SELF",
        "E-SCOPE-HOST-GONE",
        "E-SCOPE-HOST-MOVED",
        "E-SCOPE-REQUEST-UNHANDLED",
        "E-SCOPE-CAPABILITY-REVOKED",
    }
)


class ScopeError(ValueError):
    """作用域错误：code 只能是契约里的 E-SCOPE-*。"""

    def __init__(self, code: str, path: str, message: str) -> None:
        if code not in ERROR_CODES:
            raise ValueError(f"{code} 不是契约里的作用域错误码")
        self.code = code
        self.path = path
        self.message = message
        super().__init__(f"{code} @ {path}: {message}")


STANDARD_REQUESTS: Mapping[str, Mapping[str, str]] = MappingProxyType(
    {
        "remove_self": MappingProxyType({}),
        "navigate": MappingProxyType({"route": "string"}),
        "focus": MappingProxyType({}),
        "scroll_into_view": MappingProxyType({}),
        "open_overlay": MappingProxyType({"kind": "string", "props": "object"}),
        "request_data": MappingProxyType({"source": "string", "key": "string"}),
    }
)

_FIELD_TYPES: Mapping[str, type[object]] = MappingProxyType({"string": str, "object": Mapping})


class Response(StrEnum):
    """父侧对子请求的回应；`unhandled` 是显式“接不住”，不是静默丢弃。"""

    HANDLED = "handled"
    DENIED = "denied"
    UNHANDLED = "unhandled"
    HOST_GONE = "host_gone"
    HOST_MOVED = "host_moved"


@dataclass(frozen=True, slots=True)
class Request:
    """一次子 → 立即宿主的请求。"""

    name: str
    fields: Mapping[str, Any] = field(default_factory=dict)


def make_request(name: str, fields: Mapping[str, Any]) -> Request:
    """标准请求按契约校验字段；未知请求放行，交给宿主决定。"""
    if not isinstance(name, str) or name == "":
        raise ValueError("请求名必须是非空字符串")
    expected = STANDARD_REQUESTS.get(name)
    if expected is None:
        return Request(name=name, fields=MappingProxyType(dict(fields)))
    present = set(fields)
    wanted = set(expected)
    if present != wanted:
        missing = ", ".join(sorted(wanted - present)) or "-"
        extra = ", ".join(sorted(present - wanted)) or "-"
        raise ValueError(f"标准请求 {name} 字段不符：缺少 {missing}；多余 {extra}")
    for field_name, type_name in expected.items():
        value = fields[field_name]
        if not isinstance(value, _FIELD_TYPES[type_name]):
            raise ValueError(f"标准请求 {name}.{field_name} 必须是 {type_name}")
    return Request(name=name, fields=MappingProxyType(dict(fields)))

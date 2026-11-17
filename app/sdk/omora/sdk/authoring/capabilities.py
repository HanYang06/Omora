"""父授予的窄能力端口：navigation / overlay / focus / scroll / data。

端口只暴露契约里的方法，不暴露父引用；宿主关闭或能力被撤销后，
方法调用抛稳定的 E-SCOPE-*。端口方法翻译成标准请求，仍走立即宿主。
"""

from __future__ import annotations

from collections.abc import Mapping
from types import MappingProxyType
from typing import TYPE_CHECKING, Any

from .requests import Response

if TYPE_CHECKING:
    from .host import Host

CAPABILITY_TYPES: Mapping[str, tuple[str, ...]] = MappingProxyType(
    {
        "navigation": ("navigate",),
        "overlay": ("open",),
        "focus": ("focus",),
        "scroll": ("into_view",),
        "data": ("get",),
    }
)


class Capability:
    """能力端口基类：使用时才校验宿主与授予状态。"""

    name: str = ""

    def __init__(self, host: Host) -> None:
        self._host = host

    def _ready(self) -> None:
        self._host.require_capability(self.name)


class NavigationPort(Capability):
    name = "navigation"

    def navigate(self, route: str) -> Response:
        self._ready()
        return self._host.node.request("navigate", route=route)


class OverlayPort(Capability):
    name = "overlay"

    def open(self, kind: str, props: Mapping[str, Any] | None = None) -> Response:
        self._ready()
        return self._host.node.request("open_overlay", kind=kind, props=dict(props or {}))


class FocusPort(Capability):
    name = "focus"

    def focus(self) -> Response:
        self._ready()
        return self._host.node.request("focus")


class ScrollPort(Capability):
    name = "scroll"

    def into_view(self) -> Response:
        self._ready()
        return self._host.node.request("scroll_into_view")


class DataPort(Capability):
    name = "data"

    def get(self, source: str, key: str) -> Response:
        self._ready()
        return self._host.node.request("request_data", source=source, key=key)


_PORTS: Mapping[str, type[Capability]] = MappingProxyType(
    {
        "navigation": NavigationPort,
        "overlay": OverlayPort,
        "focus": FocusPort,
        "scroll": ScrollPort,
        "data": DataPort,
    }
)


def capability_for(host: Host, name: str) -> Capability:
    """按契约类型名创建端口；调用方已保证 name 合法。"""
    return _PORTS[name](host)

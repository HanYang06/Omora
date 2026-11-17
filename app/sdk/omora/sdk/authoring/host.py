"""Host：父为子创建的宿主，承接子请求并持有父授予的能力。

路由规则（见 schema/sdk/scope.json）：
- 请求只到立即宿主，不自动冒泡；父可以 handle、deny 或显式 forward 给自己的宿主。
- 标准请求父有 handle-or-deny 义务：没 handler 且没 deny 时抛 E-SCOPE-REQUEST-UNHANDLED。
- 未知请求没有 handler 时返回 Response.UNHANDLED。
- 宿主不存在/已关闭时请求返回 HOST_GONE，被 move 顶替的旧宿主返回 HOST_MOVED，都不抛错。
- 处理期间节点被移走/卸载，响应落成 HOST_MOVED / HOST_GONE。
- capability 未授予返回 None；已授予但撤销抛 E-SCOPE-CAPABILITY-REVOKED；
  宿主关闭/被顶替抛 E-SCOPE-HOST-GONE / E-SCOPE-HOST-MOVED。
"""

from __future__ import annotations

from collections.abc import Callable
from enum import StrEnum
from typing import TYPE_CHECKING, Literal, overload

from .capabilities import (
    CAPABILITY_TYPES,
    Capability,
    DataPort,
    FocusPort,
    NavigationPort,
    OverlayPort,
    ScrollPort,
    capability_for,
)
from .requests import STANDARD_REQUESTS, Request, Response, ScopeError

if TYPE_CHECKING:
    from .scope import Node

Handler = Callable[[Request], Response]


class _State(StrEnum):
    OPEN = "open"
    GONE = "gone"
    MOVED = "moved"


class Host:
    """一个子节点在父侧的位置：请求入口 + 父侧策略 + 能力授予表。

    父通过 Node.handle / deny / forward / grant / revoke 配置；
    子只能通过 capability() 取自己被授予的端口。
    """

    def __init__(self, owner: Node, node: Node) -> None:
        self._owner = owner
        self._node = node
        self._state = _State.OPEN
        self._handlers: dict[str, Handler] = {}
        self._denied: set[str] = set()
        self._forwarded: set[str] = set()
        self._grants: set[str] = set()
        self._revoked: set[str] = set()

    @property
    def node(self) -> Node:
        """宿主对应的子节点。"""
        return self._node

    @property
    def is_open(self) -> bool:
        return self._state is _State.OPEN

    @overload
    def capability(self, name: Literal["navigation"]) -> NavigationPort | None: ...

    @overload
    def capability(self, name: Literal["overlay"]) -> OverlayPort | None: ...

    @overload
    def capability(self, name: Literal["focus"]) -> FocusPort | None: ...

    @overload
    def capability(self, name: Literal["scroll"]) -> ScrollPort | None: ...

    @overload
    def capability(self, name: Literal["data"]) -> DataPort | None: ...

    @overload
    def capability(self, name: str) -> Capability | None: ...

    def capability(self, name: str) -> Capability | None:
        """取能力端口：未授予返回 None；撤销或宿主失效抛稳定错误。"""
        if name not in CAPABILITY_TYPES:
            raise ValueError(f"未知能力类型: {name}")
        self._require_open()
        if name in self._revoked:
            raise ScopeError("E-SCOPE-CAPABILITY-REVOKED", self._node.id, f"能力 {name} 已撤销")
        if name not in self._grants:
            return None
        return capability_for(self, name)

    def require_capability(self, name: str) -> None:
        """已持有端口使用前的校验：宿主有效、节点仍挂在本宿主、能力仍授予。"""
        self._require_open()
        if self._node._host is not self:
            raise ScopeError("E-SCOPE-HOST-MOVED", self._node.id, "host 已被顶替")
        if name in self._revoked or name not in self._grants:
            raise ScopeError(
                "E-SCOPE-CAPABILITY-REVOKED", self._node.id, f"能力 {name} 未授予或已撤销"
            )

    def dispatch(self, request: Request) -> Response:
        """子请求入口；宿主失效时返回 HOST_GONE/HOST_MOVED，不抛错。"""
        if not self.is_open:
            return Response.HOST_MOVED if self._state is _State.MOVED else Response.HOST_GONE
        result = self._route(request)
        if self._node._host is None:
            return Response.HOST_GONE
        if self._node._host is not self:
            return Response.HOST_MOVED
        return result

    def _route(self, request: Request) -> Response:
        handler = self._handlers.get(request.name)
        if handler is not None:
            response = handler(request)
            if not isinstance(response, Response):
                raise TypeError(f"处理器 {request.name} 必须返回 Response")
            return response
        if request.name in self._forwarded:
            return self._forward_upstream(request)
        if request.name in self._denied:
            return Response.DENIED
        if request.name in STANDARD_REQUESTS:
            raise ScopeError(
                "E-SCOPE-REQUEST-UNHANDLED",
                self._node.id,
                f"标准请求 {request.name} 没有处理器（父侧违约）",
            )
        return Response.UNHANDLED

    def _forward_upstream(self, request: Request) -> Response:
        upstream = self._owner._host
        if upstream is None:
            return Response.HOST_GONE
        return upstream.dispatch(request)

    def _require_open(self) -> None:
        if self._state is _State.OPEN:
            return
        code = "E-SCOPE-HOST-MOVED" if self._state is _State.MOVED else "E-SCOPE-HOST-GONE"
        raise ScopeError(code, self._node.id, "host 已关闭")

    # ---- 父侧配置入口（只经 Node 的同名方法调用） ----
    def _handle(self, name: str, handler: Handler) -> None:
        self._handlers[name] = handler

    def _deny(self, name: str) -> None:
        self._denied.add(name)

    def _forward(self, name: str) -> None:
        self._forwarded.add(name)

    def _grant(self, name: str) -> None:
        self._revoked.discard(name)
        self._grants.add(name)

    def _revoke(self, name: str) -> None:
        self._grants.discard(name)
        self._revoked.add(name)

    def _close_gone(self) -> None:
        self._state = _State.GONE

    def _close_moved(self) -> None:
        self._state = _State.MOVED

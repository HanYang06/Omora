"""节点作用域 / host / 页面层（Python writer 侧）。

不是一个 UI 组件库：这里有 retained 节点、父权操作、立即宿主请求、能力端口、
生命周期钩子，以及基于 root Node 的 Page（显式 mount/invalidate + When/Bind/Action）。
契约唯一来源是 `schema/sdk/scope.json` 与 `schema/sdk/page.json`。
"""

from __future__ import annotations

from .capabilities import (
    CAPABILITY_TYPES,
    Capability,
    DataPort,
    FocusPort,
    NavigationPort,
    OverlayPort,
    ScrollPort,
)
from .host import Handler, Host
from .lifecycle import LIFECYCLE_HOOKS, Hook, LifecycleEvent, LifecycleHook, LifecycleHooks
from .page import Action, Bind, Page, When
from .requests import (
    ERROR_CODES,
    STANDARD_REQUESTS,
    Request,
    Response,
    ScopeError,
)
from .scope import ID_PATTERN, Node, ParentRef, new_id

__all__ = [
    "CAPABILITY_TYPES",
    "ERROR_CODES",
    "ID_PATTERN",
    "LIFECYCLE_HOOKS",
    "STANDARD_REQUESTS",
    "Action",
    "Bind",
    "Capability",
    "DataPort",
    "FocusPort",
    "Handler",
    "Hook",
    "Host",
    "LifecycleEvent",
    "LifecycleHook",
    "LifecycleHooks",
    "NavigationPort",
    "Node",
    "OverlayPort",
    "Page",
    "ParentRef",
    "Request",
    "Response",
    "ScopeError",
    "ScrollPort",
    "When",
    "new_id",
]

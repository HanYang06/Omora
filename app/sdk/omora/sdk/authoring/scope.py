"""节点作用域：retained 对象树，父持有子，权限只向下。

- 子只拿到只读的 ParentRef（id/kind），拿不到可变父句柄；
- children 永远是直接子节点；remove 只摘下子节点本身，子节点自己的子树与 parent 链保留；
- root unmount 只关 host、保留子树与 parent 链；只有 dispose 是永久销毁；
- move 到非 live 目标时先不建 host，等目标进入 live 树再挂；
- 六种生命周期钩子见 lifecycle.py。
"""

from __future__ import annotations

import copy
import re
import secrets
from collections.abc import Mapping
from dataclasses import dataclass
from types import MappingProxyType
from typing import Any

from .capabilities import CAPABILITY_TYPES
from .host import Handler, Host
from .lifecycle import Hook, LifecycleEvent, LifecycleHook, LifecycleHooks
from .requests import Response, ScopeError, make_request

ID_PATTERN = re.compile(r"^[0-9a-f]{16}$")


def new_id() -> str:
    """出生即稳定的身份：16 位小写十六进制。"""
    return secrets.token_hex(8)


@dataclass(frozen=True, slots=True)
class ParentRef:
    """只读父引用：只有 id / kind，没有任何可变句柄。"""

    id: str
    kind: str


class Node:
    """一个 retained 节点：id / kind / props / state / children。

    生命周期钩子边界：
    - on_create 在 __init__ 末尾触发，此时字段已就绪但节点尚未挂载（parent=None）；
    - on_mount 在节点获得宿主时触发（父先子后）；move 默认只换宿主、不重挂，remount=True 才重挂；
    - on_update 由 patch 触发；on_reparent 由 move 触发；
    - on_unmount 在离开挂载树时触发（子先父后），只关 host、保留子树；
    - on_dispose 只在显式 dispose 时触发（子先父后），是永久销毁。
    """

    def __init__(
        self,
        kind: str,
        *,
        id: str | None = None,
        props: Mapping[str, Any] | None = None,
        state: Mapping[str, Any] | None = None,
        hooks: LifecycleHooks | None = None,
    ) -> None:
        if not isinstance(kind, str) or kind == "":
            raise ValueError("kind 必须是非空字符串")
        node_id = new_id() if id is None else id
        if not isinstance(node_id, str) or ID_PATTERN.fullmatch(node_id) is None:
            raise ValueError("id 必须是 16 位小写十六进制")
        self._id = node_id
        self._kind = kind
        self._props: dict[str, Any] = dict(props or {})
        self._state: dict[str, Any] = dict(state or {})
        self._children: list[Node] = []
        self._parent: Node | None = None
        self._host: Host | None = None
        self._hooks = hooks
        self._live = False
        self._disposed = False
        self._emit(LifecycleHook.CREATE)

    # ---- 只读视图 ----
    @property
    def id(self) -> str:
        return self._id

    @property
    def kind(self) -> str:
        return self._kind

    @property
    def props(self) -> Mapping[str, Any]:
        return MappingProxyType(self._props)

    @property
    def state(self) -> Mapping[str, Any]:
        return MappingProxyType(self._state)

    @property
    def children(self) -> tuple[Node, ...]:
        """永远是直接子节点，不做过滤。"""
        return tuple(self._children)

    @property
    def parent(self) -> ParentRef | None:
        parent = self._parent
        return None if parent is None else ParentRef(id=parent._id, kind=parent._kind)

    @parent.setter
    def parent(self, value: ParentRef | None) -> None:
        del value
        raise ScopeError("E-SCOPE-PARENT", self._id, "parent 只读")

    @property
    def host(self) -> Host | None:
        return self._host

    @property
    def mounted(self) -> bool:
        return self._host is not None

    @property
    def disposed(self) -> bool:
        return self._disposed

    # ---- 父权操作 ----
    def add(self, child: Node, index: int | None = None) -> Node:
        """父挂载一个子；父本身 live 时整棵子树一起挂载，否则等父进入 live 树再挂。"""
        if not isinstance(child, Node):
            raise TypeError("child 必须是 Node")
        if self._disposed or child._disposed:
            raise ValueError("已销毁的节点不能再挂载")
        if child is self or self._is_ancestor(child):
            raise ScopeError("E-SCOPE-CYCLE", self._id, "add 会成环")
        if child._parent is not None or child._host is not None:
            raise ScopeError("E-SCOPE-DUP-MOUNT", child._id, "节点已有父节点")
        self._insert(child, index)
        if self._parent is None and not self._live:
            self._live = True
            for existing in self._children:
                self._mount_subtree(existing)
        elif self._live:
            self._mount_subtree(child)
        return child

    def remove(self, child: Node) -> Node:
        """只有父能摘下直接子节点：只摘子节点本身，子树结构与 parent 链保留。"""
        self._require_child(child)
        self._children.remove(child)
        child._unmount_subtree()
        child._parent = None
        return child

    def move(
        self,
        node: Node,
        new_parent: Node,
        index: int | None = None,
        *,
        remount: bool = False,
    ) -> Node:
        """由当前父把直接子节点移到新父；目标非 live 时先不建 host。"""
        self._require_child(node)
        if not isinstance(new_parent, Node):
            raise TypeError("new_parent 必须是 Node")
        if new_parent._disposed:
            raise ValueError("不能挂到已销毁的节点")
        if node._contains(new_parent):
            raise ScopeError("E-SCOPE-MOVE-SELF", node._id, "move 目标是自己或自己的后代")
        if new_parent is self:
            self._children.remove(node)
            self._insert(node, index)
            return node
        self._children.remove(node)
        if remount:
            node._unmount_subtree()
            new_parent._insert(node, index)
            node._emit(LifecycleHook.REPARENT)
            if new_parent._live:
                new_parent._mount_subtree(node)
            return node
        was_live = node._live
        old_host = node._host
        if old_host is not None:
            old_host._close_moved()
        node._host = None
        new_parent._insert(node, index)
        node._emit(LifecycleHook.REPARENT)
        if new_parent._live:
            if was_live:
                node._host = Host(new_parent, node)
                node._live = True
            else:
                new_parent._mount_subtree(node)
        else:
            node._close_hosts_moved()
        return node

    def clone(self) -> Node:
        """克隆整棵子树：新身份、detached、复制 state 与钩子，且没有 host。"""
        cloned = Node(
            self._kind,
            props=copy.deepcopy(self._props),
            state=copy.deepcopy(self._state),
            hooks=self._hooks,
        )
        for child in self._children:
            child_clone = child.clone()
            child_clone._parent = cloned
            cloned._children.append(child_clone)
        return cloned

    def patch(
        self,
        *,
        props: Mapping[str, Any] | None = None,
        state: Mapping[str, Any] | None = None,
    ) -> Node:
        """只改自己（自己子树的一部分），不触碰父或兄弟；改动触发 update。"""
        changed = False
        if props is not None:
            self._props.update(props)
            changed = True
        if state is not None:
            self._state.update(state)
            changed = True
        if changed:
            self._emit(LifecycleHook.UPDATE)
        return self

    def request(self, name: str, **fields: Any) -> Response:
        """向立即宿主发请求；没有可用宿主时返回 HOST_GONE。"""
        host = self._host
        if host is None:
            return Response.HOST_GONE
        return host.dispatch(make_request(name, fields))

    def unmount(self) -> Node:
        """只允许根节点：关掉整棵树的 host、触发 unmount 钩子，保留子树与 parent 链。"""
        if self._parent is not None:
            raise ScopeError(
                "E-SCOPE-PARENT",
                self._id,
                "只有根节点能卸载整棵树；子节点由父 remove 或 request('remove_self')",
            )
        self._unmount_subtree()
        return self

    def dispose(self) -> Node:
        """只允许根节点：先关 host/unmount，再触发 dispose（子先父后），永久销毁。"""
        if self._parent is not None:
            raise ScopeError("E-SCOPE-PARENT", self._id, "只有根节点能 dispose 整棵树")
        self._unmount_subtree()
        self._dispose_subtree()
        return self

    # ---- 父侧配置：handle / deny / forward / grant / revoke ----
    def handle(self, child: Node, name: str, handler: Handler) -> None:
        self._child_host(child)._handle(name, handler)

    def deny(self, child: Node, name: str) -> None:
        self._child_host(child)._deny(name)

    def forward(self, child: Node, name: str) -> None:
        self._child_host(child)._forward(name)

    def grant(self, child: Node, capability: str) -> None:
        if capability not in CAPABILITY_TYPES:
            raise ValueError(f"未知能力类型: {capability}")
        self._child_host(child)._grant(capability)

    def revoke(self, child: Node, capability: str) -> None:
        self._child_host(child)._revoke(capability)

    # ---- 内部：挂载 / 卸载 / 钩子 / 权限判定 ----
    def _insert(self, child: Node, index: int | None) -> None:
        child._parent = self
        if index is None:
            self._children.append(child)
        else:
            self._children.insert(index, child)

    def _mount_subtree(self, child: Node) -> None:
        child._parent = self
        child._live = True
        if child._host is None:
            child._host = Host(self, child)
            child._emit(LifecycleHook.MOUNT)
        for grandchild in child._children:
            child._mount_subtree(grandchild)

    def _unmount_subtree(self) -> None:
        """关 host、发 unmount（子先父后）；子树、parent 链、children 全保留。"""
        was_live = self._live
        for child in self._children:
            child._unmount_subtree()
        if was_live:
            self._emit(LifecycleHook.UNMOUNT)
        self._live = False
        host = self._host
        if host is not None:
            host._close_gone()
        self._host = None

    def _close_hosts_moved(self) -> None:
        """离开 live 树（move 到非 live 目标）：关 host、保留结构，等重新 live 再挂。"""
        for child in self._children:
            child._close_hosts_moved()
        host = self._host
        if host is not None and host.is_open:
            host._close_moved()
        self._host = None
        self._live = False

    def _dispose_subtree(self) -> None:
        for child in self._children:
            child._dispose_subtree()
        if not self._disposed:
            self._disposed = True
            self._emit(LifecycleHook.DISPOSE)

    def _emit(self, hook: LifecycleHook) -> None:
        hooks = self._hooks
        if hooks is None:
            return
        callback: Hook | None = getattr(hooks, hook.value, None)
        if callback is not None:
            callback(LifecycleEvent(hook=hook, node=self, parent=self.parent))

    def _is_ancestor(self, candidate: Node) -> bool:
        current = self._parent
        while current is not None:
            if current is candidate:
                return True
            current = current._parent
        return False

    def _contains(self, candidate: Node) -> bool:
        current: Node | None = candidate
        while current is not None:
            if current is self:
                return True
            current = current._parent
        return False

    def _deny_upward(self, target: Node) -> None:
        if target is self or self._is_ancestor(target):
            raise ScopeError("E-SCOPE-PARENT", self._id, "子不能反向改动父节点")
        parent = self._parent
        if parent is not None and target._parent is parent:
            raise ScopeError("E-SCOPE-PARENT", self._id, "子不能改动兄弟节点")

    def _require_child(self, child: Node) -> None:
        if not isinstance(child, Node):
            raise TypeError("child 必须是 Node")
        self._deny_upward(child)
        if child._parent is not self:
            raise ScopeError("E-SCOPE-NOT-CHILD", child._id, "目标不是直接子节点")

    def _child_host(self, child: Node) -> Host:
        self._require_child(child)
        host = child._host
        if host is None:
            raise ScopeError("E-SCOPE-HOST-GONE", child._id, "子节点没有 host")
        return host

"""生命周期钩子：契约 lifecycle.hooks 的六种回调与事件。

钩子是“构造/挂载/更新/重挂/卸载/销毁”的显式通知，不是 React 的 render 生命周期：
- on_create 在构造完成后立即触发（字段已就绪、尚未挂载）；若回调抛错会向上传播。
- on_mount 在节点获得宿主时触发，顺序父先子后。
- on_update 由 patch 触发；on_reparent 由 move 触发。
- on_unmount 在离开挂载时触发，顺序子先父后；on_dispose 只在显式 dispose 时触发。
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from enum import StrEnum
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .scope import Node, ParentRef


class LifecycleHook(StrEnum):
    CREATE = "on_create"
    MOUNT = "on_mount"
    UPDATE = "on_update"
    REPARENT = "on_reparent"
    UNMOUNT = "on_unmount"
    DISPOSE = "on_dispose"


LIFECYCLE_HOOKS: frozenset[str] = frozenset(hook.value for hook in LifecycleHook)


@dataclass(frozen=True, slots=True)
class LifecycleEvent:
    """一次生命周期通知；`parent` 是事件发生瞬间的只读父引用快照。"""

    hook: LifecycleHook
    node: Node
    parent: ParentRef | None


Hook = Callable[[LifecycleEvent], None]


@dataclass(frozen=True, slots=True)
class LifecycleHooks:
    """六种可选回调；没给的回调就是没注册，不会被静默忽略成别的事件。"""

    on_create: Hook | None = None
    on_mount: Hook | None = None
    on_update: Hook | None = None
    on_reparent: Hook | None = None
    on_unmount: Hook | None = None
    on_dispose: Hook | None = None

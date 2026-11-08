"""插件拿到的作用域：提供服务、取用服务、登记卸载时要撤销的东西。"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

Disposer = Callable[[], None]


class Context:
    """服务表由同一作用域树共享，副作用各自撤销。"""

    def __init__(self, services: dict[str, Any] | None = None) -> None:
        self._services: dict[str, Any] = {} if services is None else services
        self._effects: list[Disposer] = []
        self._disposed = False

    @property
    def disposed(self) -> bool:
        return self._disposed

    def extend(self) -> Context:
        """开一个子作用域：服务共享，副作用分开撤销。"""
        self._assert_live()
        return Context(self._services)

    def provide[T](self, name: str, value: T) -> None:
        """登记一个服务；这个作用域撤销时自动移除。"""
        self._assert_live()
        if name in self._services:
            raise ValueError(f"服务重复提供: {name}")
        self._services[name] = value

        def undo() -> None:
            if self._services.get(name) is value:
                del self._services[name]

        self._effects.append(undo)

    def resolve(self, name: str) -> Any:
        """按名字取服务；取不到就抛错。"""
        if name not in self._services:
            raise LookupError(f"服务未提供: {name}")
        return self._services[name]

    def has(self, name: str) -> bool:
        return name in self._services

    def effect(self, fn: Disposer) -> None:
        """登记一个撤销动作；作用域撤销时按登记的逆序执行。"""
        self._assert_live()
        self._effects.append(fn)

    def dispose(self) -> None:
        """逆序撤销登记的全部动作。可重复调用。

        一次撤销抛错不会挡住后面的撤销：全部跑完之后再抛。
        只有一个错误就原样重抛，多个包成 ExceptionGroup。
        """
        if self._disposed:
            return
        self._disposed = True
        errors: list[BaseException] = []
        try:
            for fn in reversed(self._effects):
                try:
                    fn()
                except BaseException as exc:  # noqa: BLE001 — 一个撤销失败不能挡住后面的
                    errors.append(exc)
        finally:
            self._effects.clear()
        if len(errors) == 1:
            raise errors[0]
        if errors:
            raise BaseExceptionGroup(f"撤销时出错 {len(errors)} 次", errors)

    def _assert_live(self) -> None:
        if self._disposed:
            raise RuntimeError("作用域已撤销")

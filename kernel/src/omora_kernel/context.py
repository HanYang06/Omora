"""作用域树：按 token 注入绑定，并用异步钩子驱动生命周期。

一个 Context 是一个作用域：它持有绑定、子作用域与清理钩子。注入沿父链查找最近的
绑定；释放时先释放子作用域，再按登记的逆序执行本作用域的清理钩子。token 用字符串
表示，缺失时抛出语义为 E_UNAVAILABLE 的 UnavailableError。
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Protocol, runtime_checkable

Hook = Callable[[], Awaitable[None]]


class UnavailableError(LookupError):
    """token 不可解析；语义对应协议错误码 E_UNAVAILABLE。"""

    code: str = "E_UNAVAILABLE"

    def __init__(self, token: str, detail: str | None = None) -> None:
        self.token = token
        message = f"{token!r} 不可用"
        if detail is not None:
            message = f"{detail}：{message}"
        super().__init__(message)


@runtime_checkable
class Lifecycle(Protocol):
    """可被作用域接管生命周期的对象：先激活，后按逆序释放。"""

    async def activate(self) -> None: ...

    async def dispose(self) -> None: ...


class Context:
    """作用域节点。根作用域没有父作用域，子作用域由 child 创建。"""

    def __init__(self, name: str) -> None:
        self._name = name
        self._parent: Context | None = None
        self._children: list[Context] = []
        self._bindings: dict[str, object] = {}
        self._activation_hooks: list[Hook] = []
        self._dispose_hooks: list[Hook] = []
        self._active = False
        self._disposed = False

    @property
    def name(self) -> str:
        return self._name

    @property
    def parent(self) -> Context | None:
        return self._parent

    def child(self, name: str) -> Context:
        """创建并登记子作用域；释放父作用域时子作用域一并释放。"""
        if self._disposed:
            raise RuntimeError(f"作用域 {self._name!r} 已释放，不能创建子作用域")
        scope = Context(name)
        scope._parent = self
        self._children.append(scope)
        return scope

    def provide(self, token: str, value: object) -> None:
        """在本作用域绑定 token；同一作用域内重复绑定视为错误。"""
        if self._disposed:
            raise RuntimeError(f"作用域 {self._name!r} 已释放，不能提供绑定")
        if token in self._bindings:
            raise ValueError(f"token {token!r} 已在作用域 {self._name!r} 中提供")
        self._bindings[token] = value

    def inject(self, token: str) -> object:
        """沿作用域链解析 token；最近的绑定优先，缺失时抛出 UnavailableError。"""
        scope: Context | None = self
        while scope is not None:
            if token in scope._bindings:
                return scope._bindings[token]
            scope = scope._parent
        raise UnavailableError(token)

    def try_inject(self, token: str) -> object | None:
        """与 inject 相同，但 token 缺失时返回 None。"""
        scope: Context | None = self
        while scope is not None:
            if token in scope._bindings:
                return scope._bindings[token]
            scope = scope._parent
        return None

    def on_activate(self, hook: Hook) -> None:
        """登记激活钩子；作用域激活时按登记顺序执行。"""
        if self._disposed:
            raise RuntimeError(f"作用域 {self._name!r} 已释放，不能登记激活钩子")
        if self._active:
            raise RuntimeError(f"作用域 {self._name!r} 已激活，不能再登记激活钩子")
        self._activation_hooks.append(hook)

    def on_dispose(self, hook: Hook) -> None:
        """登记清理钩子；作用域释放时按登记的逆序执行。"""
        if self._disposed:
            raise RuntimeError(f"作用域 {self._name!r} 已释放，不能登记清理钩子")
        self._dispose_hooks.append(hook)

    async def activate(self) -> None:
        """按登记顺序执行激活钩子；重复激活不重复执行。"""
        if self._disposed:
            raise RuntimeError(f"作用域 {self._name!r} 已释放，不能激活")
        if self._active:
            return
        for hook in tuple(self._activation_hooks):
            await hook()
        self._active = True

    async def dispose(self) -> None:
        """释放子作用域与本作用域：逆序执行清理钩子，清空绑定，重复释放无副作用。"""
        if self._disposed:
            return
        errors: list[Exception] = []
        for child in reversed(self._children):
            try:
                await child.dispose()
            except Exception as error:
                errors.append(error)
        for hook in reversed(self._dispose_hooks):
            try:
                await hook()
            except Exception as error:
                errors.append(error)
        self._children.clear()
        self._activation_hooks.clear()
        self._dispose_hooks.clear()
        self._bindings.clear()
        self._disposed = True
        if errors:
            raise ExceptionGroup("释放作用域时出现错误", errors)

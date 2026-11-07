"""命令与查询注册表：命名空间、按作用域回收、异步分发。

命令与查询各有一个命名空间，互不影响。注册绑定在 Context 上：作用域释放时，通过它
登记的所有 handler 自动移除，这是插件热禁用不留残留的地基。分发的异常原样上抛，
错误码映射由传输层负责。
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass

from .context import Context, UnavailableError

Handler = Callable[[Mapping[str, object]], Awaitable[object]]


@dataclass(frozen=True)
class _Registration:
    handler: Handler


class _HandlerRegistry:
    """按名字登记 handler 的命名空间；清理钩子挂在作用域上。"""

    def __init__(self, namespace: str) -> None:
        self._namespace = namespace
        self._handlers: dict[str, _Registration] = {}

    def register(self, scope: Context, name: str, handler: Handler) -> None:
        """登记 handler，并把它绑定到 scope 的释放。"""
        if name in self._handlers:
            raise ValueError(f"{self._namespace} {name!r} 已注册")
        entry = _Registration(handler)

        async def remove() -> None:
            if self._handlers.get(name) is entry:
                del self._handlers[name]

        scope.on_dispose(remove)
        self._handlers[name] = entry

    async def invoke(self, name: str, args: Mapping[str, object]) -> object:
        """按名字分发；未登记的名字抛出语义为 E_UNAVAILABLE 的错误。"""
        entry = self._handlers.get(name)
        if entry is None:
            raise UnavailableError(name, f"{self._namespace}未注册")
        return await entry.handler(args)

    def names(self) -> tuple[str, ...]:
        """返回当前已登记的名字，按字典序排列。"""
        return tuple(sorted(self._handlers))


class CommandRegistry(_HandlerRegistry):
    """命令命名空间。"""

    def __init__(self) -> None:
        super().__init__("命令")


class QueryRegistry(_HandlerRegistry):
    """查询命名空间。"""

    def __init__(self) -> None:
        super().__init__("查询")

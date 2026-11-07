"""跨插件服务：提供方登记，消费方按名字调用；内核只做路由。

服务名由提供方自己命名（建议带插件前缀）。核心不实现任何服务，也不解释返回值。
提供方卸载时它提供的服务随之消失，调用方拿到 E_UNAVAILABLE 而不是一个死掉的引用。
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Mapping

from .context import Context, UnavailableError

ServiceHandler = Callable[[Mapping[str, object]], Awaitable[object]]


class ServiceProviders:
    """服务名到 handler 的注册表；生命周期挂在提供方的作用域上。"""

    def __init__(self) -> None:
        self._handlers: dict[str, ServiceHandler] = {}

    def provide(self, scope: Context, name: str, handler: ServiceHandler) -> None:
        """登记一个服务；同名重复提供视为错误。"""
        if name in self._handlers:
            raise ValueError(f"服务 {name!r} 已被提供")
        self._handlers[name] = handler

        async def remove() -> None:
            if self._handlers.get(name) is handler:
                del self._handlers[name]

        scope.on_dispose(remove)

    async def call(self, name: str, args: Mapping[str, object]) -> object:
        """调用服务；没有提供方时抛出语义为 E_UNAVAILABLE 的错误。"""
        handler = self._handlers.get(name)
        if handler is None:
            raise UnavailableError(name, "服务未提供")
        return await handler(args)

    def names(self) -> tuple[str, ...]:
        return tuple(sorted(self._handlers))

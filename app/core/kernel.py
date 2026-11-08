"""内核：插件宿主。只做加持、持有、运行、引用，外加消息转发。"""

from __future__ import annotations

from typing import Any, Protocol

from .context import Context


class Plugin(Protocol):
    """一个插件：有名字，有一件事要做（apply）。"""

    name: str

    def apply(self, ctx: Context) -> None: ...


class Kernel:
    """装上插件、记着谁在、按名字给服务。"""

    def __init__(self) -> None:
        self._root = Context()
        self._plugins: dict[str, Context] = {}

    def install(self, plugin: Plugin) -> None:
        """加持：装上并运行；运行失败就撤销它登记过的一切。"""
        if plugin.name in self._plugins:
            raise ValueError(f"插件已安装: {plugin.name}")
        ctx = self._root.extend()
        try:
            plugin.apply(ctx)
        except BaseException:
            ctx.dispose()
            raise
        self._plugins[plugin.name] = ctx

    def uninstall(self, name: str) -> None:
        """卸载：撤销这个插件登记的一切；没装过就是空操作。"""
        ctx = self._plugins.pop(name, None)
        if ctx is not None:
            ctx.dispose()

    def running(self, name: str) -> bool:
        """持有：这个插件在不在。"""
        return name in self._plugins

    def resolve(self, name: str) -> Any:
        """引用：按名字取一个服务。"""
        return self._root.resolve(name)

    def names(self) -> tuple[str, ...]:
        return tuple(self._plugins)

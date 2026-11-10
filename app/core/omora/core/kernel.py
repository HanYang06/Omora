"""内核：插件宿主。只做加持、持有、引用、运行。"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from typing import Any, Protocol

from .context import Context
from .log import Log, NullLog


class Plugin(Protocol):
    """一个插件：有名字，有一件事要做（apply）。"""

    name: str

    def apply(self, ctx: Context) -> None: ...


class Handle:
    """装上一个插件之后拿到的句柄：知道是谁，也能把它卸掉。"""

    def __init__(self, name: str, uninstall: Callable[[str], None]) -> None:
        self.name = name
        self._uninstall = uninstall

    def dispose(self) -> None:
        self._uninstall(self.name)

    def __repr__(self) -> str:
        return f"Handle({self.name!r})"


class Kernel:
    """装上插件、记着谁在、按名字给服务。"""

    def __init__(
        self, log: Log | None = None, services: Mapping[str, Any] | None = None
    ) -> None:
        self._log = log if log is not None else NullLog()
        self._root = Context(dict(services or {}), log=self._log)
        self._plugins: dict[str, Context] = {}

    def install(self, plugin: Plugin) -> Handle:
        """加持：装上并运行；运行失败就撤销它登记过的一切。"""
        if plugin.name in self._plugins:
            raise ValueError(f"插件已安装: {plugin.name}")
        ctx = self._root.extend(plugin.name)
        try:
            plugin.apply(ctx)
        except BaseException as exc:
            self._log.child(plugin.name).error("装载失败", err=type(exc).__name__)
            try:
                ctx.dispose()
            except BaseException as rollback:  # noqa: BLE001 — 回滚失败不能盖掉原始异常
                exc.add_note(f'插件 "{plugin.name}" 回滚时又出错: {rollback!r}')
            exc.add_note(f'插件 "{plugin.name}" 装载失败')
            raise
        self._plugins[plugin.name] = ctx
        self._log.child(plugin.name).info("已装")
        return Handle(plugin.name, self.uninstall)

    def uninstall(self, name: str) -> None:
        """卸载：撤销这个插件登记的一切；没装过就是空操作。"""
        ctx = self._plugins.pop(name, None)
        if ctx is not None:
            ctx.dispose()
            self._log.child(name).info("已卸")

    def running(self, name: str) -> bool:
        """持有：这个插件在不在。"""
        return name in self._plugins

    def resolve(self, name: str) -> Any:
        """引用：按名字取一个服务。"""
        return self._root.resolve(name)

    def names(self) -> tuple[str, ...]:
        return tuple(self._plugins)

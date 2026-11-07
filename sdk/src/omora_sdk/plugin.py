"""插件入口的形状:一个对象,两个生命周期方法。"""

from __future__ import annotations

from typing import Protocol

from .api import PluginContext


class Plugin(Protocol):
    """清单里的 entry 指向的模块属性必须满足这个形状。"""

    async def activate(self, ctx: PluginContext) -> None: ...

    async def deactivate(self) -> None: ...

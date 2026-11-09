"""插件唯一可以 import 的公开面。

只做一件事：把内核的 Context 与 Plugin 类型转出去，插件不必碰内核内部。
内核不 import 它；它不 import 任何插件。
"""

from omora.core.context import Context
from omora.core.kernel import Plugin

__all__ = ["Context", "Plugin"]

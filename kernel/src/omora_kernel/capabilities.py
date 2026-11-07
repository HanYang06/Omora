"""能力授权：清单里声明的能力，在运行期真的会被检查。

插件能做什么，不取决于它写了什么代码，而取决于宿主在激活时授予了什么。这是信任层的
第一道闸门：没有 capabilities 的插件，注册命令、发事件、消费服务都会被拒绝。
"""

from __future__ import annotations

from collections.abc import Iterable


class DeniedError(PermissionError):
    """插件尝试使用未被授予的能力；语义对应错误码 E_DENIED。"""

    code: str = "E_DENIED"

    def __init__(self, capability: str, detail: str) -> None:
        self.capability = capability
        super().__init__(f"缺少能力 {capability!r}: {detail}")


class Capabilities:
    """一次激活授予的能力集合；只授予一次，运行期不得扩权。"""

    def __init__(self, granted: Iterable[str]) -> None:
        self._granted = frozenset(granted)

    def granted(self) -> tuple[str, ...]:
        return tuple(sorted(self._granted))

    def require(self, capability: str, detail: str) -> None:
        """没有该能力就抛 DeniedError；有就什么也不做。"""
        if capability not in self._granted:
            raise DeniedError(capability, detail)

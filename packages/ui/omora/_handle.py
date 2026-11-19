"""页面对象：插件自己交树（推送式），不再把 build 回调交给 ui。

它只是 Ui 的入口句柄；独立成模块是为了让 ui.py 留在体量预算内，ui.py 里 re-export。
"""

from __future__ import annotations

from collections.abc import Callable
from typing import TYPE_CHECKING

from omora.sdk.ui import Page

if TYPE_CHECKING:
    from .ui import Ui


class PageHandle:
    """页面对象：插件自己交树（推送式），下一次 tree() / tree_event 用它重建。"""

    def __init__(self, ui: Ui, name: str) -> None:
        self._ui = ui
        self.name = name

    def set(self, page: Page) -> None:
        """交这一页当前的树；下一次 tree() / tree_event 按它重建。"""
        self._ui.set_page(self.name, page)

    def refresh(self) -> None:
        """校验这一页还在；真正的重建发生在下一次 tree()。"""
        self._ui.refresh_page(self.name)

    def rebuild(self, builder: Callable[[], Page]) -> None:
        """登记重建回调：客户端明确要这一页时由 ui 调一次，吸收插件装卸这类外部变化。"""
        self._ui.bind_rebuild(self.name, builder)

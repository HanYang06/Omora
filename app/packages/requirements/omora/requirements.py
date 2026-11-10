"""requirements：需求页。

现在只是占位：需求的字段还没定，先让它出现在导航里。
"""

from __future__ import annotations

from typing import Any

from omora.sdk import Context
from omora.sdk.ui import Empty, Page


class RequirementsPlugin:
    name = "requirements"

    def apply(self, ctx: Context) -> None:
        ui: Any = ctx.resolve("ui")

        def build() -> Page:
            return Page(content=Empty("还没有需求。"))

        ui.page(ctx, "requirements", "需求", build, icon="requirements")


__all__ = ["RequirementsPlugin"]

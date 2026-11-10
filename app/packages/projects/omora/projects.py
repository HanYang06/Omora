"""projects：项目页。

现在只是占位：项目的字段还没定，先让它出现在导航里。
"""

from __future__ import annotations

from typing import Any

from omora.sdk import Context
from omora.sdk.ui import Empty, Page


class ProjectsPlugin:
    name = "projects"

    def apply(self, ctx: Context) -> None:
        ui: Any = ctx.resolve("ui")

        def build() -> Page:
            return Page(content=Empty("还没有项目。"))

        ui.page(ctx, "projects", "项目", build, icon="projects")


__all__ = ["ProjectsPlugin"]

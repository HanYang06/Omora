"""inbox：最小业务插件。

只为证明闭环：插件 → 节点 → 界面 → 事件 → 回插件。不做业务设计。
不 import 别的插件（包括 store / ui 的类型）：只用服务名。
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from core.context import Context
from sdk.ui import Button, Column, Node, Row, Text


class InboxPlugin:
    name = "inbox"

    def apply(self, ctx: Context) -> None:
        store: Any = ctx.resolve("store")
        ui: Any = ctx.resolve("ui")

        def build() -> Node:
            return Column(
                Text("收件箱", kind="title"),
                *[
                    Row(
                        Text(item.title),
                        Button("归档", on_click=_archiver(store, item.id)),
                    )
                    for item in store.items()
                ],
            )

        ui.view(ctx, "main", build)


def _archiver(store: Any, item_id: int) -> Callable[[], None]:
    def run() -> None:
        store.archive(item_id)

    return run


__all__ = ["InboxPlugin"]

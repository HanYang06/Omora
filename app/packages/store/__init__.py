"""store：条目的存储与查询。

系统插件，不产出界面。数据先放内存；换 SQLite 时只改这个文件，服务接口不动。
"""

from __future__ import annotations

from dataclasses import dataclass, replace

from sdk import Context


@dataclass(frozen=True)
class Item:
    id: int
    title: str
    archived: bool = False


class Store:
    """条目的增、查、归档。"""

    def __init__(self) -> None:
        self._items: list[Item] = []
        self._next_id = 1

    def items(self) -> list[Item]:
        """没被归档的条目，按加入顺序。"""
        return [item for item in self._items if not item.archived]

    def add(self, title: str) -> Item:
        item = Item(self._next_id, title)
        self._next_id += 1
        self._items.append(item)
        return item

    def archive(self, item_id: int) -> None:
        for index, item in enumerate(self._items):
            if item.id == item_id:
                self._items[index] = replace(item, archived=True)
                return
        raise LookupError(f"条目不存在: {item_id}")


class StorePlugin:
    """把 Store 登记成服务 `store`。"""

    name = "store"

    def apply(self, ctx: Context) -> None:
        ctx.provide("store", Store())


__all__ = ["Item", "Store", "StorePlugin"]

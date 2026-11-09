"""store：条目的持久化。

系统插件，不产出界面。SQLite，一个表；条目可以只是文字，也可以挂一条媒体。
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from omora.sdk import Context


@dataclass(frozen=True)
class Item:
    id: int
    title: str
    archived: bool
    created_at: datetime
    media: str | None = None


class Store:
    def __init__(self, path: str = ":memory:") -> None:
        self._conn = sqlite3.connect(path)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute(
            """
            CREATE TABLE IF NOT EXISTS items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                archived INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                media TEXT
            )
            """
        )
        self._conn.commit()

    def items(self) -> list[Item]:
        """没被归档的条目，按加入顺序。"""
        rows = self._conn.execute(
            "SELECT id, title, archived, created_at, media FROM items"
            " WHERE archived = 0 ORDER BY id"
        ).fetchall()
        return [self._item(row) for row in rows]

    def add(self, title: str, media: str | None = None) -> Item:
        created = datetime.now()
        cursor = self._conn.execute(
            "INSERT INTO items (title, archived, created_at, media) VALUES (?, 0, ?, ?)",
            (title, created.isoformat(), media),
        )
        self._conn.commit()
        return Item(int(cursor.lastrowid or 0), title, False, created, media)

    def archive(self, item_id: int) -> None:
        cursor = self._conn.execute(
            "UPDATE items SET archived = 1 WHERE id = ? AND archived = 0", (item_id,)
        )
        if cursor.rowcount == 0:
            raise LookupError(f"条目不存在: {item_id}")
        self._conn.commit()

    @staticmethod
    def _item(row: sqlite3.Row) -> Item:
        media = row["media"]
        return Item(
            int(row["id"]),
            str(row["title"]),
            bool(row["archived"]),
            datetime.fromisoformat(str(row["created_at"])),
            None if media is None else str(media),
        )


class StorePlugin:
    name = "store"

    def __init__(self, path: str = ".omora/omora.db") -> None:
        self.path = path

    def apply(self, ctx: Context) -> None:
        if self.path != ":memory:":
            Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        ctx.provide("store", Store(self.path))


__all__ = ["Item", "Store", "StorePlugin"]

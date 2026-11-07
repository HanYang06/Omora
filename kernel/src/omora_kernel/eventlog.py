"""追加事件日志：分配单调递增 revision、按范围读取、断线追赶。

事件只追加不修改；revision 由 SQLite 自增主键分配，单调递增且不复用。日志建立
在 Store 上，读写都在显式事务内完成，因此与事务存储共享同一份一致性边界。
"""

from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass
from typing import cast

from .store import Migration, Store

EVENT_LOG_MODULE = "event_log"
EVENT_LOG_MIGRATIONS = (
    Migration(
        module=EVENT_LOG_MODULE,
        version=1,
        statements=(
            """
            CREATE TABLE IF NOT EXISTS events (
                revision INTEGER PRIMARY KEY AUTOINCREMENT,
                type TEXT NOT NULL,
                data TEXT NOT NULL
            )
            """,
        ),
    ),
)


@dataclass(frozen=True)
class Event:
    """一条已落盘的事件；data 是 JSON 可序列化的字典。"""

    revision: int
    type: str
    data: dict[str, object]


class EventLog:
    """基于 Store 的事件日志；构造时确保事件表已建立。"""

    def __init__(self, store: Store) -> None:
        self._store = store
        store.migrate(EVENT_LOG_MIGRATIONS)

    def append(self, event_type: str, data: dict[str, object]) -> Event:
        """在事务内追加事件，返回带新 revision 的事件。"""
        payload = json.dumps(data, ensure_ascii=False, sort_keys=True)
        with self._store.transaction() as connection:
            cursor = connection.execute(
                "INSERT INTO events (type, data) VALUES (?, ?)", (event_type, payload)
            )
            revision = cast("int", cursor.lastrowid)
        return Event(revision=revision, type=event_type, data=self._decode(payload))

    def read(self, from_revision: int = 1, to_revision: int | None = None) -> list[Event]:
        """读取闭区间 [from_revision, to_revision] 的事件；省略上界表示读到末尾。"""
        if to_revision is None:
            rows = self._store.query(
                "SELECT revision, type, data FROM events WHERE revision >= ? ORDER BY revision",
                (from_revision,),
            )
        else:
            rows = self._store.query(
                "SELECT revision, type, data FROM events "
                "WHERE revision >= ? AND revision <= ? ORDER BY revision",
                (from_revision, to_revision),
            )
        return [self._decode_row(row) for row in rows]

    def catch_up(self, since_revision: int) -> list[Event]:
        """返回 revision 严格大于 since_revision 的全部事件。"""
        return self.read(from_revision=since_revision + 1)

    @staticmethod
    def _decode(payload: str) -> dict[str, object]:
        return cast("dict[str, object]", json.loads(payload))

    @classmethod
    def _decode_row(cls, row: sqlite3.Row) -> Event:
        return Event(
            revision=int(row["revision"]),
            type=str(row["type"]),
            data=cls._decode(str(row["data"])),
        )

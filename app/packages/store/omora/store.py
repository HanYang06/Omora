"""store：通用持久化服务。

系统插件，不产出界面。SQLite；一个 collection 一张表。字段名、类型、
索引由用它的插件声明，store 只负责建表、迁移和参数化查询——插件不写 SQL。

迁移规则见 docs/design/migrations.md：开发期不写迁移，发布时冻结。
"""

from __future__ import annotations

import os
import sqlite3
from collections.abc import Mapping, Sequence
from pathlib import Path

from omora.sdk import Context

from ._records import _RESERVED, Collection, Field, Record, _check_name

SCHEMA_VERSION = 1


class Store:
    def __init__(self, path: str = ":memory:", *, dev: bool = False) -> None:
        self._path = path
        self._dev = dev
        self._conn = self._open()

    def _open(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self._path)
        conn.row_factory = sqlite3.Row
        row = conn.execute("PRAGMA user_version").fetchone()
        version = int(row[0]) if row is not None else 0
        if version == SCHEMA_VERSION:
            return conn
        if _is_fresh(conn):
            _set_version(conn)
            return conn
        if not self._dev:
            conn.close()
            raise RuntimeError(
                f"数据库 schema 版本 {version}，代码版本 {SCHEMA_VERSION}；"
                "没有可用的迁移（见 docs/design/migrations.md）"
            )
        conn.close()
        if self._path != ":memory:":
            Path(self._path).unlink(missing_ok=True)
        conn = sqlite3.connect(self._path)
        conn.row_factory = sqlite3.Row
        _set_version(conn)
        return conn

    def collection(
        self,
        name: str,
        *,
        fields: Mapping[str, str],
        indexes: Sequence[str] = (),
        searchable: Sequence[str] = (),
        pinned: str | None = None,
    ) -> Collection:
        _check_name(name)
        parsed: dict[str, Field] = {}
        for field_name, spec in fields.items():
            if field_name in _RESERVED:
                raise ValueError(f"字段名保留: {field_name}")
            _check_name(field_name)
            parsed[field_name] = Field(field_name, spec)
        for index in indexes:
            if index not in parsed and index not in {"created_at", "updated_at"}:
                raise ValueError(f"未知索引字段: {index}")
        searched = _search_fields(parsed, searchable)
        _pin_field(parsed, pinned)
        return Collection(self._conn, name, parsed, tuple(indexes), self._dev, searched, pinned)


def _search_fields(fields: Mapping[str, Field], searchable: Sequence[str]) -> tuple[str, ...]:
    """校验可搜字段：必须声明过、必须是 text。第一个算标题，排名靠它。"""
    found: list[str] = []
    for name in searchable:
        field = fields.get(name)
        if field is None:
            raise ValueError(f"未知搜索字段: {name}")
        if field.kind != "text":
            raise ValueError(f"搜索字段必须是 text: {name}")
        if name not in found:
            found.append(name)
    return tuple(found)


def _pin_field(fields: Mapping[str, Field], pinned: str | None) -> None:
    if pinned is None:
        return
    field = fields.get(pinned)
    if field is None:
        raise ValueError(f"未知置顶字段: {pinned}")
    if field.kind != "bool":
        raise ValueError(f"置顶字段必须是 bool: {pinned}")


class StorePlugin:
    name = "store"

    def __init__(self, path: str = ".omora/omora.db", *, dev: bool | None = None) -> None:
        self.path = path
        self.dev = _env_flag("OMORA_DEV") if dev is None else dev

    def apply(self, ctx: Context) -> None:
        if self.path != ":memory:":
            Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        ctx.provide("store", Store(self.path, dev=self.dev))


def _is_fresh(conn: sqlite3.Connection) -> bool:
    row = conn.execute(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
    ).fetchone()
    return bool(row is not None and int(row[0]) == 0)


def _set_version(conn: sqlite3.Connection) -> None:
    conn.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
    conn.commit()


def _env_flag(name: str) -> bool:
    return os.environ.get(name, "").strip() == "1"


__all__ = ["SCHEMA_VERSION", "Collection", "Record", "Store", "StorePlugin"]

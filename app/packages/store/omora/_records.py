"""collection / record 的内部实现；store.py 是门面。"""

from __future__ import annotations

import re
import sqlite3
import uuid
from collections.abc import Iterator, Mapping
from datetime import datetime
from typing import Any

DEFAULT_LIMIT = 50
MAX_LIMIT = 200
_RESERVED = frozenset({"id", "created_at", "updated_at"})
_NAME_RE = re.compile(r"^[a-z][a-z0-9_]{0,63}$")
_OPERATORS = frozenset({"$eq", "$ne", "$gt", "$gte", "$lt", "$lte", "$in"})
# LIKE 的转义符：用 ! 而不是反斜杠，省得和 Python、SQL 各转义一层。
_LIKE_ESCAPE = "!"
_SQL_TYPES = {"text": "TEXT", "int": "INTEGER", "float": "REAL", "bool": "INTEGER", "time": "TEXT"}


class Field:
    """一个字段的声明：类型 + 是否可选。"""

    def __init__(self, name: str, spec: str) -> None:
        raw = spec.strip()
        self.optional = raw.endswith("?")
        self.kind = raw[:-1] if self.optional else raw
        if self.kind not in _SQL_TYPES:
            raise ValueError(f"未知字段类型: {name}={spec}")
        self.name = name

    @property
    def sql_type(self) -> str:
        return _SQL_TYPES[self.kind]

    def check(self, value: Any) -> Any:
        if value is None:
            if self.optional:
                return None
            raise ValueError(f"字段 {self.name} 不能为空")
        if self.kind == "text":
            if not isinstance(value, str):
                raise ValueError(f"字段 {self.name} 要 text")
        elif self.kind == "int":
            if isinstance(value, bool) or not isinstance(value, int):
                raise ValueError(f"字段 {self.name} 要 int")
        elif self.kind == "float":
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                raise ValueError(f"字段 {self.name} 要 float")
            return float(value)
        elif self.kind == "bool":
            if not isinstance(value, bool):
                raise ValueError(f"字段 {self.name} 要 bool")
        elif not isinstance(value, datetime):
            raise ValueError(f"字段 {self.name} 要 time")
        return value


class Record(Mapping[str, Any]):
    """一行记录；字段既能 record["title"] 也能 record.title。"""

    def __init__(self, data: dict[str, Any]) -> None:
        self._data = data

    def __getitem__(self, key: str) -> Any:
        return self._data[key]

    def __iter__(self) -> Iterator[str]:
        return iter(self._data)

    def __len__(self) -> int:
        return len(self._data)

    def __getattr__(self, name: str) -> Any:
        try:
            return self._data[name]
        except KeyError:
            raise AttributeError(name) from None

    def __repr__(self) -> str:
        return f"Record({self._data!r})"


class Collection:
    """一个 collection：建表、CRUD、结构化查询。"""

    def __init__(
        self,
        conn: sqlite3.Connection,
        name: str,
        fields: dict[str, Field],
        indexes: tuple[str, ...],
        dev: bool,
        searchable: tuple[str, ...] = (),
        pinned: str | None = None,
    ) -> None:
        self._conn = conn
        self._name = name
        self._fields = fields
        self._indexes = indexes
        self._dev = dev
        self._searchable = searchable
        self._pinned = pinned
        self._table = f"col_{name}"
        self._ensure()

    def add(self, **values: Any) -> Record:
        extra = set(values) - set(self._fields)
        if extra:
            raise ValueError(f"未知字段: {', '.join(sorted(extra))}")
        now = datetime.now()
        data: dict[str, Any] = {"id": uuid.uuid4().hex, "created_at": now, "updated_at": now}
        for name, field in self._fields.items():
            data[name] = field.check(values.get(name))
        columns = ", ".join(f'"{name}"' for name in data)
        marks = ", ".join("?" for _ in data)
        self._conn.execute(
            f'INSERT INTO "{self._table}" ({columns}) VALUES ({marks})',
            [_encode(value) for value in data.values()],
        )
        self._conn.commit()
        return Record(data)

    def get(self, record_id: str) -> Record | None:
        row = self._conn.execute(
            f'SELECT * FROM "{self._table}" WHERE "id" = ?', (record_id,)
        ).fetchone()
        return None if row is None else self._record(row)

    def update(self, record_id: str, **values: Any) -> Record:
        if not values:
            raise ValueError("update 至少要改一个字段")
        extra = set(values) - set(self._fields)
        if extra:
            raise ValueError(f"未知字段: {', '.join(sorted(extra))}")
        changes = {name: self._fields[name].check(value) for name, value in values.items()}
        changes["updated_at"] = datetime.now()
        assignments = ", ".join(f'"{name}" = ?' for name in changes)
        cursor = self._conn.execute(
            f'UPDATE "{self._table}" SET {assignments} WHERE "id" = ?',
            [_encode(value) for value in changes.values()] + [record_id],
        )
        if cursor.rowcount == 0:
            self._conn.rollback()
            raise LookupError(f"记录不存在: {record_id}")
        self._conn.commit()
        record = self.get(record_id)
        assert record is not None
        return record

    def delete(self, record_id: str) -> None:
        cursor = self._conn.execute(f'DELETE FROM "{self._table}" WHERE "id" = ?', (record_id,))
        if cursor.rowcount == 0:
            raise LookupError(f"记录不存在: {record_id}")
        self._conn.commit()

    def find(
        self,
        where: Mapping[str, Any] | None = None,
        *,
        order: str | None = None,
        limit: int = DEFAULT_LIMIT,
        offset: int = 0,
    ) -> list[Record]:
        _check_limit(limit)
        _check_offset(offset)
        conditions, params = self._conditions(where)
        sql = f'SELECT * FROM "{self._table}"{_where_clause(conditions)}'
        if order is not None:
            sql += f" ORDER BY {self._order(order)}"
        sql += " LIMIT ? OFFSET ?"
        rows = self._conn.execute(sql, [*params, limit, offset]).fetchall()
        return [self._record(row) for row in rows]

    def search(
        self,
        query: str,
        *,
        limit: int = DEFAULT_LIMIT,
        offset: int = 0,
        where: Mapping[str, Any] | None = None,
    ) -> list[Record]:
        """按声明的 searchable 字段做子串匹配。

        标题字段（searchable 的第一个）命中的排前面，然后置顶的，然后新的。
        查询和过滤条件都走参数化 SQL；没有查询词就没有结果。
        """
        _check_limit(limit)
        _check_offset(offset)
        text = query.strip()
        if not text:
            return []
        if not self._searchable:
            raise ValueError(f"collection {self._name} 没有声明 searchable 字段")
        pattern = _like(text)
        conditions, params = self._conditions(where)
        matched = " OR ".join(
            f'"{name}" LIKE ? ESCAPE {_LIKE_ESCAPE!r}' for name in self._searchable
        )
        conditions.insert(0, f"({matched})")
        order = [
            f'CASE WHEN "{self._searchable[0]}" LIKE ? ESCAPE {_LIKE_ESCAPE!r} THEN 0 ELSE 1 END',
        ]
        if self._pinned is not None:
            order.append(f'CASE WHEN "{self._pinned}" IS 1 THEN 0 ELSE 1 END')
        order.append('"created_at" DESC')
        sql = (
            f'SELECT * FROM "{self._table}"{_where_clause(conditions)}'
            f" ORDER BY {', '.join(order)} LIMIT ? OFFSET ?"
        )
        values = [*([pattern] * len(self._searchable)), *params, pattern, limit, offset]
        rows = self._conn.execute(sql, values).fetchall()
        return [self._record(row) for row in rows]

    def count(self, where: Mapping[str, Any] | None = None) -> int:
        conditions, params = self._conditions(where)
        row = self._conn.execute(
            f'SELECT COUNT(*) FROM "{self._table}"{_where_clause(conditions)}', params
        ).fetchone()
        assert row is not None
        return int(row[0])

    def _conditions(self, where: Mapping[str, Any] | None) -> tuple[list[str], list[Any]]:
        if not where:
            return [], []
        conditions: list[str] = []
        params: list[Any] = []
        for name, condition in where.items():
            field = self._fields.get(name)
            if field is None:
                raise ValueError(f"未知字段: {name}")
            if isinstance(condition, Mapping):
                if not condition:
                    raise ValueError(f"字段 {name} 的过滤条件为空")
                for operator, value in condition.items():
                    if operator not in _OPERATORS:
                        raise ValueError(f"不支持的过滤操作: {operator}")
                    clause, values = _condition(f'"{name}"', operator, value, field)
                    conditions.append(clause)
                    params.extend(values)
            elif condition is None:
                conditions.append(f'"{name}" IS NULL')
            else:
                field.check(condition)
                conditions.append(f'"{name}" = ?')
                params.append(_encode(condition))
        return conditions, params

    def _order(self, order: str) -> str:
        parts = order.strip().split()
        if len(parts) not in (1, 2):
            raise ValueError(f"order 格式不对: {order!r}")
        field = parts[0]
        if len(parts) == 2 and parts[1].lower() not in {"asc", "desc"}:
            raise ValueError(f"order 方向只能是 asc/desc: {order!r}")
        if field not in {"created_at", "updated_at"} and field not in self._fields:
            raise ValueError(f"未知 order 字段: {field}")
        direction = "DESC" if len(parts) == 2 and parts[1].lower() == "desc" else "ASC"
        return f'"{field}" {direction}'

    def _ensure(self) -> None:
        columns = self._columns()
        if columns is not None and columns != self._expected():
            if not self._dev:
                raise RuntimeError(
                    f"collection {self._name} 的字段变了；发布版需要迁移"
                    "（见 docs/design/migrations.md）"
                )
            self._conn.execute(f'DROP TABLE "{self._table}"')
            columns = None
        if columns is None:
            self._create()
        self._create_indexes()

    def _columns(self) -> dict[str, tuple[str, bool]] | None:
        rows = self._conn.execute(f'PRAGMA table_info("{self._table}")').fetchall()
        if not rows:
            return None
        return {
            str(row["name"]): (str(row["type"]).upper(), bool(row["notnull"])) for row in rows
        }

    def _expected(self) -> dict[str, tuple[str, bool]]:
        expected = {
            "id": ("TEXT", True),
            "created_at": ("TEXT", True),
            "updated_at": ("TEXT", True),
        }
        for name, field in self._fields.items():
            expected[name] = (field.sql_type, not field.optional)
        return expected

    def _create(self) -> None:
        columns = [
            '"id" TEXT PRIMARY KEY NOT NULL',
            '"created_at" TEXT NOT NULL',
            '"updated_at" TEXT NOT NULL',
        ]
        for name, field in self._fields.items():
            null = "" if field.optional else " NOT NULL"
            columns.append(f'"{name}" {field.sql_type}{null}')
        self._conn.execute(f'CREATE TABLE "{self._table}" ({", ".join(columns)})')
        self._conn.commit()

    def _create_indexes(self) -> None:
        for field in dict.fromkeys(("created_at", *self._indexes)):
            if field not in {"created_at", "updated_at"} and field not in self._fields:
                raise ValueError(f"未知索引字段: {field}")
            self._conn.execute(
                f'CREATE INDEX IF NOT EXISTS "idx_{self._table}_{field}"'
                f' ON "{self._table}" ("{field}")'
            )
        self._conn.commit()

    def _record(self, row: sqlite3.Row) -> Record:
        data: dict[str, Any] = {
            "id": str(row["id"]),
            "created_at": _decode_time(row["created_at"]),
            "updated_at": _decode_time(row["updated_at"]),
        }
        for name, field in self._fields.items():
            data[name] = _decode(field, row[name])
        return Record(data)


def _check_limit(limit: int) -> None:
    if not 1 <= limit <= MAX_LIMIT:
        raise ValueError(f"limit 必须在 1–{MAX_LIMIT}，当前 {limit}")


def _check_offset(offset: int) -> None:
    if offset < 0:
        raise ValueError("offset 不能为负")


def _where_clause(conditions: list[str]) -> str:
    return "" if not conditions else " WHERE " + " AND ".join(conditions)


def _like(term: str) -> str:
    """查询词 → LIKE 模式；% 与 _ 当普通字符，不当通配符。"""
    escaped = term.replace(_LIKE_ESCAPE, _LIKE_ESCAPE * 2)
    escaped = escaped.replace("%", _LIKE_ESCAPE + "%").replace("_", _LIKE_ESCAPE + "_")
    return f"%{escaped}%"


def _condition(column: str, operator: str, value: Any, field: Field) -> tuple[str, list[Any]]:
    if operator == "$in":
        if not isinstance(value, (list, tuple, set)) or not value:
            raise ValueError("$in 需要一个非空列表")
        items = [field.check(item) for item in value]
        marks = ", ".join("?" for _ in items)
        return f"{column} IN ({marks})", [_encode(item) for item in items]
    if value is None:
        if operator == "$eq":
            return f"{column} IS NULL", []
        if operator == "$ne":
            return f"{column} IS NOT NULL", []
        raise ValueError(f"{operator} 不支持 None")
    field.check(value)
    sql = {"$eq": "=", "$ne": "!=", "$gt": ">", "$gte": ">=", "$lt": "<", "$lte": "<="}[operator]
    return f"{column} {sql} ?", [_encode(value)]


def _encode(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, bool):
        return int(value)
    return value


def _decode(field: Field, value: Any) -> Any:
    if value is None:
        return None
    if field.kind == "bool":
        return bool(value)
    if field.kind == "time":
        return _decode_time(value)
    if field.kind == "float":
        return float(value)
    if field.kind == "int":
        return int(value)
    return str(value)


def _decode_time(value: Any) -> datetime:
    return datetime.fromisoformat(str(value))


def _check_name(name: str) -> None:
    if _NAME_RE.fullmatch(name) is None:
        raise ValueError(f"非法名字: {name!r}（小写字母开头，字母/数字/下划线）")

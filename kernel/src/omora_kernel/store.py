"""SQLite 存储原语：连接、WAL、事务、版本化迁移与备份。

一个 Store 持有一个连接。事务可嵌套，内层用 savepoint 实现；迁移按模块分别记录
版本，同一模块内按 version 升序应用且只应用一次；备份使用 SQLite 在线备份 API。
"""

from __future__ import annotations

import sqlite3
from collections.abc import Generator, Sequence
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path

MIGRATIONS_TABLE = """
CREATE TABLE IF NOT EXISTS schema_migrations (
    module TEXT NOT NULL,
    version INTEGER NOT NULL,
    PRIMARY KEY (module, version)
)
"""


@dataclass(frozen=True)
class Migration:
    """一条迁移：所属模块、版本与按顺序执行的语句。"""

    module: str
    version: int
    statements: tuple[str, ...]


class Store:
    """单个 SQLite 连接；自动提交模式下由 transaction 控制显式事务。"""

    def __init__(self, path: str | Path) -> None:
        self._depth = 0
        self._connection = sqlite3.connect(str(path), isolation_level=None)
        self._connection.row_factory = sqlite3.Row
        self._connection.execute("PRAGMA journal_mode=WAL")
        self._connection.execute("PRAGMA foreign_keys=ON")
        self._connection.execute(MIGRATIONS_TABLE)

    def execute(self, sql: str, parameters: Sequence[object] = ()) -> sqlite3.Cursor:
        """直接执行一条语句；事务边界由调用方决定。"""
        return self._connection.execute(sql, parameters)

    def query(self, sql: str, parameters: Sequence[object] = ()) -> list[sqlite3.Row]:
        """执行查询并取回全部行。"""
        return self._connection.execute(sql, parameters).fetchall()

    @contextmanager
    def transaction(self) -> Generator[sqlite3.Connection]:
        """显式事务；嵌套事务用 savepoint，异常时回滚到进入时的状态。"""
        connection = self._connection
        depth = self._depth
        if depth == 0:
            connection.execute("BEGIN IMMEDIATE")
        else:
            connection.execute(f"SAVEPOINT scope_{depth}")
        self._depth = depth + 1
        try:
            yield connection
        except BaseException:
            self._depth = depth
            if depth == 0:
                connection.execute("ROLLBACK")
            else:
                connection.execute(f"ROLLBACK TO scope_{depth}")
                connection.execute(f"RELEASE scope_{depth}")
            raise
        else:
            self._depth = depth
            if depth == 0:
                connection.execute("COMMIT")
            else:
                connection.execute(f"RELEASE scope_{depth}")

    def migrate(self, migrations: Sequence[Migration]) -> None:
        """应用尚未应用的迁移；同一模块内按版本升序，每条迁移一个事务。"""
        applied = self._applied_migrations()
        pending: list[Migration] = []
        seen: set[tuple[str, int]] = set()
        for migration in sorted(migrations, key=lambda item: (item.module, item.version)):
            if migration.version <= 0:
                raise ValueError(f"迁移版本必须为正: {migration.module} {migration.version}")
            key = (migration.module, migration.version)
            if key in seen:
                raise ValueError(f"迁移重复: {migration.module} {migration.version}")
            seen.add(key)
            if key not in applied:
                pending.append(migration)
        for migration in pending:
            with self.transaction() as connection:
                for statement in migration.statements:
                    connection.execute(statement)
                connection.execute(
                    "INSERT INTO schema_migrations (module, version) VALUES (?, ?)",
                    (migration.module, migration.version),
                )

    def backup(self, target: str | Path) -> None:
        """把当前数据库完整写入 target。"""
        destination = sqlite3.connect(str(target))
        try:
            self._connection.backup(destination)
        finally:
            destination.close()

    def close(self) -> None:
        """关闭连接。"""
        self._connection.close()

    def _applied_migrations(self) -> set[tuple[str, int]]:
        rows = self.query("SELECT module, version FROM schema_migrations")
        return {(str(row["module"]), int(row["version"])) for row in rows}

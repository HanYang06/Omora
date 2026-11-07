"""SQLite 存储原语的行为：事务提交/回滚、嵌套事务、版本化迁移与备份。"""

from __future__ import annotations

import sqlite3
from pathlib import Path

from omora_kernel.store import Migration, Store


def values(store: Store) -> list[str]:
    return [str(row["value"]) for row in store.query("SELECT value FROM probe ORDER BY rowid")]


def v1() -> Migration:
    return Migration(
        module="probe",
        version=1,
        statements=("CREATE TABLE probe (value TEXT NOT NULL)",),
    )


def v2() -> Migration:
    return Migration(
        module="probe",
        version=2,
        statements=("ALTER TABLE probe ADD COLUMN note TEXT",),
    )


def test_transaction_commits_writes(tmp_path: Path) -> None:
    store = Store(tmp_path / "store.db")
    try:
        store.execute("CREATE TABLE probe (value TEXT NOT NULL)")
        with store.transaction() as connection:
            connection.execute("INSERT INTO probe (value) VALUES (?)", ("kept",))

        assert values(store) == ["kept"]
    finally:
        store.close()


def test_transaction_rolls_back_on_error(tmp_path: Path) -> None:
    store = Store(tmp_path / "store.db")
    try:
        store.execute("CREATE TABLE probe (value TEXT NOT NULL)")
        try:
            with store.transaction() as connection:
                connection.execute("INSERT INTO probe (value) VALUES (?)", ("discarded",))
                raise RuntimeError("boom")
        except RuntimeError as error:
            assert str(error) == "boom"

        assert values(store) == []
    finally:
        store.close()


def test_inner_transaction_rollback_keeps_outer_writes(tmp_path: Path) -> None:
    store = Store(tmp_path / "store.db")
    try:
        store.execute("CREATE TABLE probe (value TEXT NOT NULL)")
        with store.transaction() as connection:
            connection.execute("INSERT INTO probe (value) VALUES (?)", ("outer",))
            try:
                with store.transaction() as inner:
                    inner.execute("INSERT INTO probe (value) VALUES (?)", ("inner",))
                    raise RuntimeError("inner")
            except RuntimeError:
                pass
            connection.execute("INSERT INTO probe (value) VALUES (?)", ("after",))

        assert values(store) == ["outer", "after"]
    finally:
        store.close()


def test_outer_transaction_rollback_discards_inner_writes(tmp_path: Path) -> None:
    store = Store(tmp_path / "store.db")
    try:
        store.execute("CREATE TABLE probe (value TEXT NOT NULL)")
        try:
            with store.transaction() as connection:
                connection.execute("INSERT INTO probe (value) VALUES (?)", ("outer",))
                with store.transaction() as inner:
                    inner.execute("INSERT INTO probe (value) VALUES (?)", ("inner",))
                raise RuntimeError("outer")
        except RuntimeError:
            pass

        assert values(store) == []
    finally:
        store.close()


def test_migrations_apply_once_and_keep_existing_data(tmp_path: Path) -> None:
    store = Store(tmp_path / "store.db")
    try:
        store.migrate((v1(),))
        store.execute("INSERT INTO probe (value) VALUES (?)", ("kept",))
        store.migrate((v1(), v2()))
        store.migrate((v1(), v2()))
        store.execute("INSERT INTO probe (value, note) VALUES (?, ?)", ("added", "ok"))

        assert values(store) == ["kept", "added"]
    finally:
        store.close()


def test_migrations_are_versioned_per_module(tmp_path: Path) -> None:
    store = Store(tmp_path / "store.db")
    try:
        store.migrate(
            (
                Migration(
                    module="alpha", version=1, statements=("CREATE TABLE alpha (value TEXT)",)
                ),
                Migration(module="beta", version=1, statements=("CREATE TABLE beta (value TEXT)",)),
            )
        )
        store.execute("INSERT INTO alpha (value) VALUES ('a')")
        store.execute("INSERT INTO beta (value) VALUES ('b')")

        assert [str(row["value"]) for row in store.query("SELECT value FROM beta")] == ["b"]
    finally:
        store.close()


def test_failed_migration_rolls_back_and_can_be_retried(tmp_path: Path) -> None:
    store = Store(tmp_path / "store.db")
    try:
        broken = Migration(
            module="probe",
            version=1,
            statements=(
                "CREATE TABLE probe (value TEXT NOT NULL)",
                "INSERT INTO missing_table (value) VALUES ('x')",
            ),
        )
        try:
            store.migrate((broken,))
        except sqlite3.OperationalError:
            pass
        else:
            raise AssertionError("坏迁移应抛出 OperationalError")

        store.migrate((v1(),))
        store.execute("INSERT INTO probe (value) VALUES ('ok')")

        assert values(store) == ["ok"]
    finally:
        store.close()


def test_store_opens_in_wal_mode(tmp_path: Path) -> None:
    store = Store(tmp_path / "store.db")
    try:
        assert str(store.query("PRAGMA journal_mode")[0][0]).lower() == "wal"
    finally:
        store.close()


def test_backup_copies_database(tmp_path: Path) -> None:
    target = tmp_path / "backup.db"
    source = Store(tmp_path / "source.db")
    try:
        source.execute("CREATE TABLE probe (value TEXT NOT NULL)")
        source.execute("INSERT INTO probe (value) VALUES ('copied')")
        source.backup(target)
    finally:
        source.close()

    restored = Store(target)
    try:
        assert values(restored) == ["copied"]
    finally:
        restored.close()

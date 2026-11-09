import sqlite3
from datetime import datetime
from pathlib import Path

import pytest

from omora.core.kernel import Kernel
from omora.store import Collection, Store, StorePlugin

FIELDS = {"title": "text", "done": "bool?", "when": "time?"}


def _notes(store: Store) -> Collection:
    return store.collection("notes", fields=FIELDS, indexes=["done"])


def test_adding_a_record_returns_its_fields() -> None:
    record = _notes(Store()).add(title="买牛奶")

    assert record.title == "买牛奶"
    assert record.done is None
    assert record.id
    assert isinstance(record.created_at, datetime)


def test_a_record_can_be_fetched_by_id() -> None:
    notes = _notes(Store())
    record = notes.add(title="买牛奶", done=True)

    found = notes.get(record.id)

    assert found is not None
    assert found.title == "买牛奶"
    assert found.done is True


def test_get_says_none_for_an_unknown_id() -> None:
    assert _notes(Store()).get("nope") is None


def test_update_changes_fields_and_updated_at() -> None:
    notes = _notes(Store())
    record = notes.add(title="买牛奶")

    changed = notes.update(record.id, done=True)

    assert changed.done is True
    assert changed.updated_at >= record.updated_at


def test_update_an_unknown_record_says_which_id() -> None:
    with pytest.raises(LookupError, match="记录不存在: nope"):
        _notes(Store()).update("nope", done=True)


def test_delete_removes_the_record() -> None:
    notes = _notes(Store())
    record = notes.add(title="买牛奶")

    notes.delete(record.id)

    assert notes.get(record.id) is None


def test_delete_an_unknown_record_says_which_id() -> None:
    with pytest.raises(LookupError, match="记录不存在: nope"):
        _notes(Store()).delete("nope")


def test_find_filters_by_equality_and_in() -> None:
    notes = _notes(Store())
    notes.add(title="买牛奶", done=False)
    notes.add(title="写周报", done=True)

    assert [record.title for record in notes.find({"done": False})] == ["买牛奶"]
    assert [record.title for record in notes.find({"title": {"$in": ["买牛奶", "看书"]}})] == [
        "买牛奶"
    ]


def test_find_orders_and_pages() -> None:
    notes = _notes(Store())
    for title in ("a", "b", "c"):
        notes.add(title=title)

    assert [record.title for record in notes.find(order="title desc")] == ["c", "b", "a"]
    assert [record.title for record in notes.find(order="title", limit=2)] == ["a", "b"]
    assert [record.title for record in notes.find(order="title", limit=2, offset=2)] == ["c"]


def test_find_rejects_an_unbounded_limit() -> None:
    with pytest.raises(ValueError, match="limit"):
        _notes(Store()).find(limit=1000)


def test_find_rejects_an_unknown_field() -> None:
    with pytest.raises(ValueError, match="未知字段: nope"):
        _notes(Store()).find({"nope": 1})


def test_count_matches_the_filter() -> None:
    notes = _notes(Store())
    notes.add(title="a", done=True)
    notes.add(title="b", done=False)

    assert notes.count() == 2
    assert notes.count({"done": True}) == 1


def test_a_time_field_round_trips_through_the_database(tmp_path: Path) -> None:
    path = str(tmp_path / "omora.db")
    when = datetime(2026, 11, 9, 12, 0)
    record = _notes(Store(path)).add(title="a", when=when)

    found = _notes(Store(path)).get(record.id)

    assert found is not None
    assert found.when == when


def test_records_survive_reopening_the_database(tmp_path: Path) -> None:
    path = str(tmp_path / "omora.db")
    record = _notes(Store(path)).add(title="买牛奶")

    found = _notes(Store(path)).get(record.id)

    assert found is not None
    assert found.title == "买牛奶"


def test_a_changed_schema_needs_a_migration_in_release(tmp_path: Path) -> None:
    path = str(tmp_path / "omora.db")
    _notes(Store(path)).add(title="a")

    with pytest.raises(RuntimeError, match="需要迁移"):
        Store(path).collection("notes", fields={"title": "text", "extra": "text?"})


def test_a_changed_schema_resets_in_dev(tmp_path: Path) -> None:
    path = str(tmp_path / "omora.db")
    _notes(Store(path)).add(title="a")

    notes = Store(path, dev=True).collection("notes", fields={"title": "text"})

    assert notes.count() == 0


def test_an_old_database_is_reset_in_dev(tmp_path: Path) -> None:
    path = str(tmp_path / "omora.db")
    conn = sqlite3.connect(path)
    conn.execute("CREATE TABLE items (id INTEGER PRIMARY KEY, title TEXT)")
    conn.execute("INSERT INTO items (title) VALUES ('旧数据')")
    conn.commit()
    conn.close()

    store = Store(path, dev=True)

    assert store.collection("notes", fields={"title": "text"}).count() == 0


def test_an_old_database_is_an_error_in_release(tmp_path: Path) -> None:
    path = str(tmp_path / "omora.db")
    conn = sqlite3.connect(path)
    conn.execute("CREATE TABLE items (id INTEGER PRIMARY KEY, title TEXT)")
    conn.commit()
    conn.close()

    with pytest.raises(RuntimeError, match="没有可用的迁移"):
        Store(path)


def test_installing_the_plugin_makes_store_reachable_by_name(tmp_path: Path) -> None:
    kernel = Kernel()
    kernel.install(StorePlugin(path=str(tmp_path / "omora.db")))

    store = kernel.resolve("store")
    notes = store.collection("notes", fields={"title": "text"})
    notes.add(title="买牛奶")

    assert [record.title for record in notes.find()] == ["买牛奶"]


def test_uninstalling_the_plugin_takes_the_store_away(tmp_path: Path) -> None:
    kernel = Kernel()
    kernel.install(StorePlugin(path=str(tmp_path / "omora.db")))

    kernel.uninstall("store")

    with pytest.raises(LookupError, match="服务未提供: store"):
        kernel.resolve("store")

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


SEARCH_FIELDS = {
    "title": "text",
    "body": "text?",
    "note": "text?",
    "pinned": "bool",
    "archived": "bool?",
}


def _posts(store: Store) -> Collection:
    """声明两个可搜字段（title 算标题）和一个置顶字段。"""
    return store.collection(
        "posts",
        fields=SEARCH_FIELDS,
        indexes=["archived"],
        searchable=["title", "body"],
        pinned="pinned",
    )


def test_search_matches_a_substring_of_the_title() -> None:
    posts = _posts(Store())
    posts.add(title="买牛奶", pinned=False)
    posts.add(title="写周报", pinned=False)

    assert [record.title for record in posts.search("牛奶")] == ["买牛奶"]


def test_search_matches_the_other_declared_fields() -> None:
    posts = _posts(Store())
    posts.add(title="明天的清单", body="下班顺路买牛奶", pinned=False)

    assert [record.title for record in posts.search("牛奶")] == ["明天的清单"]


def test_search_ignores_fields_that_were_not_declared_searchable() -> None:
    posts = _posts(Store())
    posts.add(title="明天的清单", body=None, note="买牛奶", pinned=False)

    assert posts.search("牛奶") == []


def test_search_is_case_insensitive_for_ascii() -> None:
    posts = _posts(Store())
    posts.add(title="Milk Run", pinned=False)

    assert [record.title for record in posts.search("milk")] == ["Milk Run"]


def test_search_treats_like_wildcards_as_plain_text() -> None:
    posts = _posts(Store())
    posts.add(title="100% 确定", pinned=False)
    posts.add(title="百分之百", pinned=False)

    assert [record.title for record in posts.search("100%")] == ["100% 确定"]
    assert [record.title for record in posts.search("%")] == ["100% 确定"]
    assert posts.search("_") == []


def test_search_never_runs_the_query_as_sql() -> None:
    posts = _posts(Store())
    posts.add(title="买牛奶", pinned=False)

    assert posts.search("'; DROP TABLE col_posts; --") == []
    assert posts.count() == 1


def test_search_ranks_title_matches_before_body_matches() -> None:
    posts = _posts(Store())
    posts.add(title="明天的清单", body="买牛奶", pinned=False)
    posts.add(title="牛奶计划", body=None, pinned=False)

    assert [record.title for record in posts.search("牛奶")] == [
        "牛奶计划",
        "明天的清单",
    ]


def test_search_ranks_pinned_matches_before_newer_ones() -> None:
    posts = _posts(Store())
    older = posts.add(title="牛奶 A", pinned=False)
    posts.add(title="牛奶 B", pinned=False)
    posts.update(older.id, pinned=True)

    assert [record.title for record in posts.search("牛奶")] == ["牛奶 A", "牛奶 B"]


def test_search_lists_the_newest_match_first() -> None:
    posts = _posts(Store())
    posts.add(title="牛奶 A", pinned=False)
    posts.add(title="牛奶 B", pinned=False)

    assert [record.title for record in posts.search("牛奶")] == ["牛奶 B", "牛奶 A"]


def test_search_pages_through_the_matches() -> None:
    posts = _posts(Store())
    for title in ("牛奶 1", "牛奶 2", "牛奶 3"):
        posts.add(title=title, pinned=False)

    first = posts.search("牛奶", limit=2)
    rest = posts.search("牛奶", limit=2, offset=2)

    assert len(first) == 2
    assert [record.title for record in rest] == ["牛奶 1"]
    assert {record.title for record in first}.isdisjoint({record.title for record in rest})


def test_search_follows_a_filter() -> None:
    posts = _posts(Store())
    posts.add(title="牛奶 A", pinned=False, archived=False)
    posts.add(title="牛奶 B", pinned=False, archived=True)

    found = posts.search("牛奶", where={"archived": False})

    assert [record.title for record in found] == ["牛奶 A"]


def test_search_returns_the_declared_values() -> None:
    posts = _posts(Store())
    posts.add(title="牛奶 1", body="冷的", pinned=True, archived=False)

    found = posts.search("牛奶")[0]

    assert (found.title, found.body, found.pinned, found.archived) == (
        "牛奶 1",
        "冷的",
        True,
        False,
    )


def test_an_empty_query_finds_nothing() -> None:
    posts = _posts(Store())
    posts.add(title="牛奶", pinned=False)

    assert posts.search("   ") == []


def test_searching_without_declared_fields_is_an_error() -> None:
    notes = Store().collection("notes", fields={"title": "text"})

    with pytest.raises(ValueError, match="searchable"):
        notes.search("牛奶")


def test_search_rejects_an_unbounded_limit() -> None:
    with pytest.raises(ValueError, match="limit"):
        _posts(Store()).search("牛奶", limit=1000)


def test_search_rejects_a_negative_offset() -> None:
    with pytest.raises(ValueError, match="offset"):
        _posts(Store()).search("牛奶", offset=-1)


def test_declaring_an_unknown_search_column_is_an_error() -> None:
    with pytest.raises(ValueError, match="未知搜索字段: nope"):
        Store().collection("notes", fields={"title": "text"}, searchable=["nope"])


def test_declaring_a_non_text_search_column_is_an_error() -> None:
    with pytest.raises(ValueError, match="必须是 text"):
        Store().collection("notes", fields={"title": "text", "views": "int"}, searchable=["views"])


def test_declaring_an_unknown_pin_column_is_an_error() -> None:
    with pytest.raises(ValueError, match="未知置顶字段: nope"):
        Store().collection("notes", fields={"title": "text"}, pinned="nope")


def test_declaring_a_non_bool_pin_column_is_an_error() -> None:
    with pytest.raises(ValueError, match="必须是 bool"):
        Store().collection("notes", fields={"title": "text"}, pinned="title")

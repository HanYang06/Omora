from datetime import datetime
from pathlib import Path

import pytest

from omora.core.kernel import Kernel
from omora.plugins.store import Store, StorePlugin


def test_adding_an_item_makes_it_visible_in_items() -> None:
    store = Store()

    store.add("买牛奶")

    assert [item.title for item in store.items()] == ["买牛奶"]


def test_archiving_an_item_removes_it_from_items() -> None:
    store = Store()
    milk = store.add("买牛奶")
    store.add("写周报")

    store.archive(milk.id)

    assert [item.title for item in store.items()] == ["写周报"]


def test_archiving_an_unknown_item_says_which_id_is_missing() -> None:
    store = Store()

    with pytest.raises(LookupError, match="条目不存在: 42"):
        store.archive(42)


def test_ids_keep_counting_after_an_archive() -> None:
    store = Store()
    first = store.add("买牛奶")
    store.archive(first.id)

    second = store.add("写周报")
    third = store.add("看书")

    assert (second.id, third.id) == (2, 3)


def test_items_survive_reopening_the_database(tmp_path: Path) -> None:
    path = str(tmp_path / "omora.db")
    first = Store(path)
    added = first.add("买牛奶")

    second = Store(path)

    assert [(item.id, item.title) for item in second.items()] == [(added.id, "买牛奶")]


def test_an_item_remembers_its_media(tmp_path: Path) -> None:
    path = str(tmp_path / "omora.db")
    Store(path).add("语音", media="abc")

    assert Store(path).items()[0].media == "abc"


def test_adding_an_item_records_when_it_happened() -> None:
    before = datetime.now()

    item = Store().add("买牛奶")

    after = datetime.now()
    assert before <= item.created_at <= after


def test_installing_the_plugin_makes_store_reachable_by_name(tmp_path: Path) -> None:
    kernel = Kernel()

    kernel.install(StorePlugin(path=str(tmp_path / "omora.db")))

    store = kernel.resolve("store")
    store.add("买牛奶")
    assert [item.title for item in store.items()] == ["买牛奶"]


def test_uninstalling_the_plugin_takes_the_store_away() -> None:
    kernel = Kernel()
    kernel.install(StorePlugin(path=":memory:"))

    kernel.uninstall("store")

    with pytest.raises(LookupError, match="服务未提供: store"):
        kernel.resolve("store")
